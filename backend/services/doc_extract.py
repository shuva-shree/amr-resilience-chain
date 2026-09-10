"""
Vendor-document metadata extraction.

Pluggable: a dependency-free heuristic parser (default) and a Google Document AI
adapter that activates when DOC_AI_PROCESSOR is configured
(projects/<p>/locations/<loc>/processors/<id>).
"""
from __future__ import annotations

import io
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

DOC_AI_PROCESSOR = os.getenv("DOC_AI_PROCESSOR")

_AMOUNT_RE = re.compile(r"(?:total|amount due|grand total|invoice total|balance due)\s*[:\-]?\s*"
                        r"(?:USD|EUR|INR|GBP|\$|₹|€|£)?\s*([0-9][0-9,]*\.?[0-9]{0,2})", re.I)
_CURRENCY_RE = re.compile(r"\b(USD|EUR|INR|GBP)\b|([$₹€£])")
_VENDOR_RE = re.compile(r"(?:vendor|supplier|from|bill(?:ed)? from|sold by|company)\s*[:\-]\s*([A-Z][\w&.,'’\- ]{2,60})", re.I)
_DATE_RES = [
    re.compile(r"(?:expir\w*|valid (?:until|through|to)|end date|renewal)\s*[:\-]?\s*"
               r"(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Z][a-z]+ \d{1,2},? \d{4})", re.I),
]
_INVOICE_NO_RE = re.compile(r"invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9\-/]{3,25})", re.I)
_LINE_ITEM_RE = re.compile(
    r"^\s*(?P<desc>[A-Za-z][\w %.,\-()/]+?)\s{2,}"
    r"(?P<qty>\d+(?:\.\d+)?)\s+"
    r"(?:[$₹€£]?\s?(?P<unit>\d[\d,]*\.?\d{0,2}))\s+"
    r"(?:[$₹€£]?\s?(?P<total>\d[\d,]*\.?\d{0,2}))\s*$",
    re.M,
)


def _to_float(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _parse_date(s: str) -> Optional[str]:
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%d-%m-%Y", "%B %d, %Y", "%B %d %Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _pdf_to_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader  # optional
    except Exception:
        try:
            from PyPDF2 import PdfReader  # type: ignore
        except Exception:
            return ""
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:  # noqa: BLE001
        return ""


def to_text(data: bytes, content_type: str, filename: str) -> str:
    name = (filename or "").lower()
    if content_type == "application/pdf" or name.endswith(".pdf"):
        return _pdf_to_text(data)
    if content_type.startswith("text/") or name.endswith((".txt", ".csv", ".md")):
        return data.decode("utf-8", errors="ignore")
    # docx / xlsx etc. — best effort decode
    return data.decode("utf-8", errors="ignore")


def heuristic_extract(text: str) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    if not text.strip():
        return {"method": "none", "confidence": 0.0}

    if (m := _VENDOR_RE.search(text)):
        meta["vendor_name"] = m.group(1).strip().rstrip(".,")
    if (m := _AMOUNT_RE.search(text)):
        meta["invoice_amount"] = _to_float(m.group(1))
    if (m := _CURRENCY_RE.search(text)):
        symbol = {"$": "USD", "₹": "INR", "€": "EUR", "£": "GBP"}
        meta["currency"] = m.group(1) or symbol.get(m.group(2), None)
    if (m := _INVOICE_NO_RE.search(text)):
        meta["invoice_number"] = m.group(1)
    for rx in _DATE_RES:
        if (m := rx.search(text)):
            meta["contract_expiration"] = _parse_date(m.group(1))
            break

    items: List[Dict[str, Any]] = []
    for lm in _LINE_ITEM_RE.finditer(text):
        items.append({
            "description": lm.group("desc").strip(),
            "quantity": _to_float(lm.group("qty")),
            "unit_price": _to_float(lm.group("unit")),
            "line_total": _to_float(lm.group("total")),
        })
    if items:
        meta["line_items"] = items[:50]

    filled = sum(1 for k in ("vendor_name", "invoice_amount", "contract_expiration") if meta.get(k))
    meta["method"] = "heuristic"
    meta["confidence"] = round(0.25 + 0.25 * filled, 2)
    return meta


def document_ai_extract(data: bytes, content_type: str) -> Optional[Dict[str, Any]]:
    if not DOC_AI_PROCESSOR:
        return None
    try:
        from google.cloud import documentai  # type: ignore

        client = documentai.DocumentProcessorServiceClient()
        raw = documentai.RawDocument(content=data, mime_type=content_type or "application/pdf")
        result = client.process_document(
            request=documentai.ProcessRequest(name=DOC_AI_PROCESSOR, raw_document=raw)
        )
        doc = result.document
        meta: Dict[str, Any] = {"method": "document_ai", "confidence": 0.9}
        for ent in doc.entities:
            key = ent.type_.lower()
            val = ent.mention_text
            if key in ("supplier_name", "vendor", "vendor_name"):
                meta["vendor_name"] = val
            elif key in ("total_amount", "net_amount", "amount_due", "invoice_total"):
                meta["invoice_amount"] = _to_float(val)
            elif key in ("currency",):
                meta["currency"] = val
            elif key in ("invoice_id", "invoice_number"):
                meta["invoice_number"] = val
            elif "date" in key and ("due" in key or "expir" in key or "end" in key):
                meta["contract_expiration"] = _parse_date(val)
        return meta
    except Exception:  # noqa: BLE001
        return None


def extract(data: bytes, content_type: str, filename: str) -> Dict[str, Any]:
    text = to_text(data, content_type, filename)
    if (ai := document_ai_extract(data, content_type)):
        # fill gaps from the heuristic parse
        heur = heuristic_extract(text)
        for k, v in heur.items():
            ai.setdefault(k, v)
        return ai
    return heuristic_extract(text)
