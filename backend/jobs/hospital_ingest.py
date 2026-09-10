"""
Module 2 — Frequent hospital / pathology-lab data ingestion.

Pathways (all converge on the same sanitise → validate → load pipeline):
  * REST push     : POST /api/v1/ingestion/hospital/records   (JSON array)
  * FHIR push     : POST /api/v1/ingestion/hospital/fhir      (R4 Bundle of Observations)
  * Bucket drop   : files landed in gs://amr-hospital-staging/... auto-processed
                    by process_bucket_drops() (event listener / poll)

PII/PHI is stripped by services.pii before anything reaches BigQuery. Clean
isolate rows land in `amr_isolates` (data_source='hospital'); every batch is
tracked in `hospital_ingestion_batches`.
"""
from __future__ import annotations

import argparse
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.core import storage
from backend.database.bigquery_client import BigQueryClient
from backend.services.pii import sanitize_batch

_ISOLATE_TABLE = "amr_isolates"
_BATCH_TABLE = "hospital_ingestion_batches"
_REQUIRED = ("collection_date", "pathogen", "antibiotic", "interpretation")
_VALID_INTERP = {"R", "I", "S"}

# name -> id reference maps, loaded once from BigQuery so ingested rows carry the
# canonical antibiotic_id / pathogen_id and not just free-text names.
_REF: Dict[str, Dict[str, str]] = {}


def _ref_maps(bq: Optional[BigQueryClient]) -> Dict[str, Dict[str, str]]:
    if _REF or bq is None:
        return _REF
    try:
        abx = {r["antibiotic_name"].strip().lower(): r["antibiotic_id"]
               for r in bq.query(f"SELECT antibiotic_id, antibiotic_name FROM {bq.table('antibiotics')}")}
        pat = {r["pathogen_name"].strip().lower(): r["pathogen_id"]
               for r in bq.query(f"SELECT pathogen_id, pathogen_name FROM {bq.table('pathogens')}")}
        _REF["antibiotics"], _REF["pathogens"] = abx, pat
    except Exception:  # noqa: BLE001 - resolution is best-effort
        pass
    return _REF


def _resolve_id(kind: str, name: str, bq: Optional[BigQueryClient]) -> Optional[str]:
    return _ref_maps(bq).get(kind, {}).get((name or "").strip().lower())


def _coerce_isolate(rec: Dict[str, Any], hospital_id: Optional[str], batch_id: str,
                    bq: Optional[BigQueryClient] = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    g = {k.lower(): v for k, v in rec.items()}
    interp = str(g.get("interpretation") or g.get("ast_result") or "").strip().upper()[:1]
    if interp not in _VALID_INTERP:
        return None, f"invalid interpretation '{g.get('interpretation')}'"
    date_raw = g.get("collection_date") or g.get("specimen_date") or g.get("effective_date")
    try:
        coll = datetime.fromisoformat(str(date_raw)[:10]).date().isoformat()
    except Exception:  # noqa: BLE001
        return None, f"invalid collection_date '{date_raw}'"
    pathogen = str(g.get("pathogen") or g.get("organism") or "").strip()
    antibiotic = str(g.get("antibiotic") or g.get("agent") or "").strip()
    if not pathogen or not antibiotic:
        return None, "missing pathogen/antibiotic"

    mic = g.get("mic_value") or g.get("mic")
    try:
        mic = float(mic) if mic not in (None, "") else None
    except (ValueError, TypeError):
        mic = None

    row = {
        "isolate_id": f"ISO-{uuid.uuid4().hex[:14]}",
        "data_source": "hospital",
        "batch_id": batch_id,
        "hospital_id": hospital_id or g.get("hospital_id"),
        "region": g.get("region") or "South-East Asia",
        "who_region": g.get("who_region") or "South-East Asia",
        "country": g.get("country") or "India",
        "collection_date": coll,
        "specimen": (g.get("specimen") or "unknown").lower(),
        "infection_type": g.get("infection_type") or g.get("infection"),
        "pathogen": pathogen,
        "pathogen_id": g.get("pathogen_id") or _resolve_id("pathogens", pathogen, bq),
        "antibiotic": antibiotic,
        "antibiotic_id": g.get("antibiotic_id") or _resolve_id("antibiotics", antibiotic, bq),
        "mic_value": mic,
        "mic_unit": g.get("mic_unit") or ("mg/L" if mic is not None else None),
        "interpretation": interp,
        "resistance_mechanism": g.get("resistance_mechanism") or ("none"),
        "patient_age_group": g.get("patient_age_group"),
        "patient_sex": (str(g.get("patient_sex") or g.get("sex") or "U").strip().upper()[:1] or "U"),
        "patient_setting": g.get("patient_setting") or g.get("setting"),
    }
    return row, None


def process_records(
    records: List[Dict[str, Any]],
    source: str,
    hospital_id: Optional[str] = None,
    submitted_by: str = "system",
    object_uri: Optional[str] = None,
    bq: Optional[BigQueryClient] = None,
) -> Dict[str, Any]:
    bq = bq or BigQueryClient()
    batch_id = f"HB-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:6]}"
    received = datetime.now(timezone.utc)

    clean_records, removed_fields = sanitize_batch(records)

    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, str]] = []
    for rec in clean_records:
        row, err = _coerce_isolate(rec, hospital_id, batch_id, bq)
        if row:
            accepted.append(row)
        else:
            rejected.append({"error": err or "invalid", "record": json.dumps(rec)[:300]})

    inserted = 0
    load_error = None
    try:
        table = f"{bq.project_id}.{bq.dataset_id}.{_ISOLATE_TABLE}"
        for i in range(0, len(accepted), 2000):
            chunk = accepted[i:i + 2000]
            errs = bq.client.insert_rows_json(table, chunk)
            if errs:
                raise RuntimeError(str(errs[:2]))
            inserted += len(chunk)
        status = "loaded" if not rejected else "partial"
    except Exception as exc:  # noqa: BLE001
        status = "failed"
        load_error = str(exc)[:800]

    batch_row = {
        "batch_id": batch_id,
        "source": source,
        "hospital_id": hospital_id,
        "received_at": received.isoformat(),
        "object_uri": object_uri,
        "record_count": len(records),
        "accepted_count": inserted,
        "rejected_count": len(rejected),
        "pii_fields_removed": json.dumps(removed_fields),
        "status": status,
        "error": load_error,
        "submitted_by": submitted_by,
    }
    bq.client.insert_rows_json(f"{bq.project_id}.{bq.dataset_id}.{_BATCH_TABLE}", [batch_row])

    return {
        "batch_id": batch_id,
        "status": status,
        "received": len(records),
        "accepted": inserted,
        "rejected": len(rejected),
        "rejected_sample": rejected[:5],
        "pii_fields_removed": removed_fields,
    }


# ---------------------------------------------------------------------------
# FHIR R4 Bundle → records
# ---------------------------------------------------------------------------
_FHIR_INTERP = {"R": "R", "I": "I", "S": "S", "RR": "R", "NS": "R", "SDD": "I"}


def fhir_bundle_to_records(bundle: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for entry in bundle.get("entry", []):
        res = entry.get("resource", {})
        if res.get("resourceType") != "Observation":
            continue
        rec: Dict[str, Any] = {}
        code = (res.get("code", {}).get("text")
                or (res.get("code", {}).get("coding") or [{}])[0].get("display"))
        # "<organism> susceptibility to <agent>" or component-based
        if code and " to " in code.lower():
            left, right = re.split(r"\bto\b", code, maxsplit=1, flags=re.I)
            rec["pathogen"] = re.sub(r"susceptibilit\w*", "", left, flags=re.I).strip(" :-")
            rec["antibiotic"] = right.strip(" .:-")
        rec.setdefault("antibiotic", code or "")
        vq = res.get("valueQuantity") or {}
        if vq.get("value") is not None:
            rec["mic_value"] = vq["value"]
            rec["mic_unit"] = vq.get("unit") or vq.get("code")
        interp = res.get("interpretation") or []
        if interp:
            c = (interp[0].get("coding") or [{}])[0].get("code", "")
            rec["interpretation"] = _FHIR_INTERP.get(c.upper(), c.upper()[:1])
        rec["collection_date"] = (res.get("effectiveDateTime") or res.get("issued") or "")[:10]
        spec = res.get("specimen", {}).get("display") or res.get("specimen", {}).get("reference", "")
        if spec:
            rec["specimen"] = spec.split("/")[-1]
        for ext in res.get("extension", []):
            url = ext.get("url", "").rsplit("/", 1)[-1]
            rec[url] = ext.get("valueString") or ext.get("valueInteger") or ext.get("valueCode")
        out.append(rec)
    return out


# ---------------------------------------------------------------------------
# Bucket-drop listener (Eventarc handler payload or manual poll)
# ---------------------------------------------------------------------------
def _parse_drop(name: str, data: bytes) -> List[Dict[str, Any]]:
    if name.lower().endswith(".json"):
        payload = json.loads(data.decode("utf-8", errors="ignore"))
        if isinstance(payload, dict) and payload.get("resourceType") == "Bundle":
            return fhir_bundle_to_records(payload)
        if isinstance(payload, dict) and "records" in payload:
            return payload["records"]
        return payload if isinstance(payload, list) else [payload]
    if name.lower().endswith(".csv"):
        import csv as _csv

        text = data.decode("utf-8", errors="ignore")
        return list(_csv.DictReader(text.splitlines()))
    return []


def process_drop_object(key: str, bq: Optional[BigQueryClient] = None) -> Dict[str, Any]:
    be = storage.backend(storage.HOSPITAL_BUCKET)
    data = be.get(key)
    records = _parse_drop(key, data)
    hospital_id = key.split("/")[0] if "/" in key else None
    result = process_records(
        records, source="bucket_drop", hospital_id=hospital_id,
        submitted_by="bucket-listener", object_uri=f"gs://{storage.HOSPITAL_BUCKET}/{key}", bq=bq,
    )
    return result


def process_bucket_drops(prefix: str = "", bq: Optional[BigQueryClient] = None) -> Dict[str, Any]:
    bq = bq or BigQueryClient()
    be = storage.backend(storage.HOSPITAL_BUCKET)
    processed_keys = {
        r["object_uri"].split(f"{storage.HOSPITAL_BUCKET}/")[-1]
        for r in bq.query(
            f"SELECT object_uri FROM {bq.table('hospital_ingestion_batches')} "
            f"WHERE source = 'bucket_drop' AND object_uri IS NOT NULL"
        )
        if r.get("object_uri")
    }
    results = []
    for obj in be.list(prefix or ""):
        if obj.key in processed_keys or not obj.key.lower().endswith((".json", ".csv")):
            continue
        results.append(process_drop_object(obj.key, bq=bq))
    return {"drops_processed": len(results), "results": results}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--drops", action="store_true", help="process new hospital bucket drops")
    ap.add_argument("--file", help="local JSON/CSV file of lab records to ingest")
    ap.add_argument("--hospital", default="H001")
    a = ap.parse_args()
    if a.drops:
        print(json.dumps(process_bucket_drops(), indent=2, default=str))
    elif a.file:
        import pathlib

        recs = _parse_drop(a.file, pathlib.Path(a.file).read_bytes())
        print(json.dumps(process_records(recs, source="rest_api", hospital_id=a.hospital, submitted_by="cli"), indent=2, default=str))
