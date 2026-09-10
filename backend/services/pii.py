"""
PII / PHI sanitisation for inbound hospital surveillance records.

Removes or generalises direct identifiers before anything is written to
BigQuery. Applied to every hospital feed (REST, FHIR, bucket drop).
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any, Dict, List, Tuple

# Field names (case-insensitive, substring match) that must never be stored.
_DROP_FIELDS = {
    "patient_name", "name", "first_name", "last_name", "surname", "given_name",
    "mrn", "medical_record_number", "patient_id", "nhs_number", "ssn", "aadhaar",
    "national_id", "phone", "telephone", "mobile", "email", "address", "street",
    "postcode", "zip", "zipcode", "pincode", "dob", "date_of_birth", "birth_date",
    "next_of_kin", "guardian", "insurance_number", "passport",
}

_SALT = b"amr-resilience-pseudonym-salt"

_AGE_BANDS = [(5, "0-4"), (18, "5-17"), (65, "18-64"), (200, "65+")]

_FREETEXT_PATTERNS = [
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[email]"),
    # phone: 9+ digits once separators are stripped (ISO dates have <=8)
    (re.compile(r"(?<!\d)\+?\d[\d\s().-]{8,}\d(?!\d)"), "[phone]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[id]"),
]

# Free-text fields are where PII hides. Structured fields (dates, codes, lab
# values, organism / drug names) are passed through untouched.
_FREETEXT_KEYS = (
    "note", "notes", "comment", "remark", "text", "description", "reason",
    "clinical", "history", "narrative", "summary", "details", "message",
)


def _pseudonymise(value: str) -> str:
    return "P-" + hashlib.sha256(_SALT + value.encode()).hexdigest()[:16]


def _age_to_band(age: Any) -> str | None:
    try:
        a = int(float(age))
    except (TypeError, ValueError):
        return None
    for ceiling, band in _AGE_BANDS:
        if a < ceiling:
            return band
    return "65+"


def _dob_to_band(dob: Any) -> str | None:
    for parser in (lambda v: datetime.fromisoformat(str(v)).date(),):
        try:
            b = parser(dob)
            years = (date.today() - b).days // 365
            return _age_to_band(years)
        except Exception:  # noqa: BLE001
            continue
    return None


def scrub_freetext(text: str) -> str:
    for pat, repl in _FREETEXT_PATTERNS:
        text = pat.sub(repl, text)
    return text


def sanitize_record(record: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Return (clean_record, list_of_removed_or_transformed_fields)."""
    clean: Dict[str, Any] = {}
    removed: List[str] = []

    # Derive an age band from whatever age/dob signal exists, before dropping.
    age_band = None
    for k, v in record.items():
        lk = k.lower()
        if lk in ("age", "patient_age", "age_years"):
            age_band = _age_to_band(v)
        elif lk in ("dob", "date_of_birth", "birth_date"):
            age_band = age_band or _dob_to_band(v)

    for k, v in record.items():
        lk = k.lower().strip()
        if any(bad in lk for bad in _DROP_FIELDS):
            removed.append(k)
            continue
        if isinstance(v, str) and any(ft in lk for ft in _FREETEXT_KEYS):
            scrubbed = scrub_freetext(v)
            if scrubbed != v:
                removed.append(f"{k} (redacted)")
            clean[k] = scrubbed
        else:
            clean[k] = v

    if age_band:
        clean.setdefault("patient_age_group", age_band)
    # Pseudonymous linkage id if the source sent one of the dropped identifiers.
    for k in ("patient_id", "mrn", "medical_record_number"):
        if k in record and record[k]:
            clean["subject_pseudonym"] = _pseudonymise(str(record[k]))
            break

    return clean, removed


def sanitize_batch(records: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    out: List[Dict[str, Any]] = []
    removed_all: set[str] = set()
    for rec in records:
        clean, removed = sanitize_record(rec)
        out.append(clean)
        removed_all.update(removed)
    return out, sorted(removed_all)
