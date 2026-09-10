"""
Module 3 — Vendor document management + admin approval workflow.

Upload → store in gs://amr-vendor-docs/YYYY/MM/ → OCR/heuristic metadata
extraction → admin review (validate / approve / reject) → notification webhook.

`vendor_documents` rows are immutable facts. The current review status is
derived from the append-only `vendor_document_events` log, which is the
immutable audit trail. Nothing is ever UPDATEd.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile
from google.cloud import bigquery
from pydantic import BaseModel

from backend.core import storage
from backend.core.http import DomainError, Identity, ok, require_admin
from backend.database.bigquery_client import bq_manager as bq
from backend.services.doc_extract import extract

router = APIRouter(prefix="/api/v1/vendor", tags=["vendor-docs"])

_DOCS = bq.table("vendor_documents")
_EVENTS = bq.table("vendor_document_events")
_MAX_BYTES = 25 * 1024 * 1024
_WEBHOOK = os.getenv("VENDOR_WEBHOOK_URL")

_TRANSITIONS = {
    "pending": {"validate": "validated", "reject": "rejected"},
    "validated": {"approve": "approved", "reject": "rejected"},
    "rejected": {},
    "approved": {},
}
_REVIEW_EVENTS = ("validated", "approved", "rejected")

# Derived-status projection reused by list + get.
_DOC_WITH_STATUS = f"""
  WITH latest_status AS (
    SELECT document_id, to_status,
           ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY event_timestamp DESC) rn
    FROM {_EVENTS} WHERE to_status IS NOT NULL
  ),
  latest_review AS (
    SELECT document_id, actor_id, event_timestamp, notes,
           ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY event_timestamp DESC) rn
    FROM {_EVENTS} WHERE event_type IN ('validated','approved','rejected')
  )
  SELECT d.* EXCEPT(status, reviewed_by, reviewed_at, review_notes),
         COALESCE(ls.to_status, 'pending') AS status,
         lr.actor_id       AS reviewed_by,
         lr.event_timestamp AS reviewed_at,
         lr.notes          AS review_notes
  FROM {_DOCS} d
  LEFT JOIN latest_status ls ON d.document_id = ls.document_id AND ls.rn = 1
  LEFT JOIN latest_review lr ON d.document_id = lr.document_id AND lr.rn = 1
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(document_id, event_type, identity, from_status=None, to_status=None, notes=None):
    bq.client.insert_rows_json(f"{bq.project_id}.{bq.dataset_id}.vendor_document_events", [{
        "event_id": f"VDE-{uuid.uuid4().hex}",
        "document_id": document_id,
        "event_type": event_type,
        "actor_id": identity.user_id,
        "actor_role": identity.role,
        "from_status": from_status,
        "to_status": to_status,
        "notes": notes,
        "event_timestamp": _now(),
    }])


def _notify(event: str, doc: dict) -> None:
    if not _WEBHOOK:
        return
    try:
        httpx.post(_WEBHOOK, json={"event": event, "document": doc}, timeout=4.0)
    except Exception:  # noqa: BLE001
        pass


def _derive_status(document_id: str) -> str:
    rows = bq.query(
        f"SELECT to_status FROM {_EVENTS} WHERE document_id=@id AND to_status IS NOT NULL "
        f"ORDER BY event_timestamp DESC LIMIT 1",
        [bigquery.ScalarQueryParameter("id", "STRING", document_id)],
    )
    return rows[0]["to_status"] if rows else "pending"


@router.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    vendor_name: Optional[str] = Form(None),
    doc_type: str = Form("invoice"),
    identity: Identity = Depends(require_admin),
):
    data = await file.read()
    if not data:
        raise DomainError("EMPTY_FILE", "The uploaded file is empty.", 400)
    if len(data) > _MAX_BYTES:
        raise DomainError("FILE_TOO_LARGE", "Documents must be 25 MB or smaller.", 413)

    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    _ALLOWED_EXT = (".pdf", ".png", ".jpg", ".jpeg", ".txt", ".csv")
    _ALLOWED_CT = ("application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv")
    _bad_type = DomainError(
        "UNSUPPORTED_FILE_TYPE",
        "Unsupported file type. Upload a PDF, PNG/JPG scan, or plain-text/CSV file "
        "(export Word/Excel documents to PDF first).",
        415,
    )
    if "." in name:
        # trust the filename extension when there is one
        if not name.endswith(_ALLOWED_EXT):
            raise _bad_type
    elif not any(ctype.startswith(c) for c in _ALLOWED_CT):
        raise _bad_type

    now = datetime.now(timezone.utc)
    key = storage.timestamp_key("", file.filename or "document", now).lstrip("/")
    obj = storage.backend(storage.VENDOR_BUCKET).put(
        key, data, content_type=file.content_type or "application/octet-stream"
    )

    meta = extract(data, file.content_type or "", file.filename or "")
    document_id = f"VDOC-{uuid.uuid4().hex[:16]}"
    row = {
        "document_id": document_id,
        "vendor_name": vendor_name or meta.get("vendor_name"),
        "doc_type": doc_type,
        "object_uri": obj.uri,
        "original_filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(data),
        "status": "pending",
        "invoice_amount": meta.get("invoice_amount"),
        "currency": meta.get("currency"),
        "contract_expiration": meta.get("contract_expiration"),
        "line_items": json.dumps(meta.get("line_items", [])),
        "extracted_metadata": json.dumps(meta),
        "extraction_method": meta.get("method", "none"),
        "uploaded_by": identity.user_id,
        "uploaded_at": _now(),
    }
    bq.client.insert_rows_json(f"{bq.project_id}.{bq.dataset_id}.vendor_documents", [row])
    _audit(document_id, "uploaded", identity, to_status="pending",
           notes=f"{file.filename} ({len(data)} bytes)")
    _audit(document_id, "extracted", identity,
           notes=f"method={meta.get('method')} confidence={meta.get('confidence')}")
    _notify("vendor.document.uploaded", row)
    return ok({"document_id": document_id, "status": "pending", "extracted_metadata": meta})


@router.get("/documents")
def list_documents(status: Optional[str] = None, identity: Identity = Depends(require_admin)):
    conds, params = [], []
    if status and status != "ALL":
        conds.append("status = @status")
        params.append(bigquery.ScalarQueryParameter("status", "STRING", status))
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    rows = bq.query(f"""
        SELECT document_id, vendor_name, doc_type, status, invoice_amount, currency,
               contract_expiration, extraction_method, original_filename, size_bytes,
               uploaded_by, uploaded_at, reviewed_by, reviewed_at
        FROM ({_DOC_WITH_STATUS})
        {where}
        ORDER BY uploaded_at DESC
        LIMIT 200
    """, params)
    return ok(rows, count=len(rows))


@router.get("/documents/{document_id}")
def get_document(document_id: str, identity: Identity = Depends(require_admin)):
    rows = bq.query(
        f"SELECT * FROM ({_DOC_WITH_STATUS}) WHERE document_id = @id LIMIT 1",
        [bigquery.ScalarQueryParameter("id", "STRING", document_id)],
    )
    if not rows:
        raise DomainError("NOT_FOUND", "Document not found.", 404)
    doc = rows[0]
    for k in ("line_items", "extracted_metadata"):
        if isinstance(doc.get(k), str):
            try:
                doc[k] = json.loads(doc[k])
            except (ValueError, TypeError):
                pass
    events = bq.query(
        f"SELECT * FROM {_EVENTS} WHERE document_id = @id ORDER BY event_timestamp ASC",
        [bigquery.ScalarQueryParameter("id", "STRING", document_id)],
    )
    uri = doc["object_uri"]
    key = uri.split("/", 3)[-1] if uri.startswith("gs://") else uri
    try:
        download_url = storage.backend(storage.VENDOR_BUCKET).signed_url(key, minutes=30)
    except Exception:  # noqa: BLE001
        download_url = uri
    doc["allowed_actions"] = list(_TRANSITIONS.get(doc["status"], {}).keys())
    return ok({"document": doc, "events": events, "download_url": download_url})


class TransitionRequest(BaseModel):
    action: str          # validate | approve | reject
    notes: Optional[str] = None


@router.post("/documents/{document_id}/transition")
def transition(document_id: str, payload: TransitionRequest, identity: Identity = Depends(require_admin)):
    exists = bq.query(
        f"SELECT vendor_name, doc_type, invoice_amount FROM {_DOCS} WHERE document_id=@id LIMIT 1",
        [bigquery.ScalarQueryParameter("id", "STRING", document_id)],
    )
    if not exists:
        raise DomainError("NOT_FOUND", "Document not found.", 404)

    current = _derive_status(document_id)
    allowed = _TRANSITIONS.get(current, {})
    if payload.action not in allowed:
        raise DomainError(
            "INVALID_TRANSITION",
            f"Cannot '{payload.action}' a document that is '{current}'. "
            f"Allowed: {', '.join(allowed) or 'none'}.",
            409,
        )
    new_status = allowed[payload.action]
    event_type = "validated" if payload.action == "validate" else payload.action
    _audit(document_id, event_type, identity, from_status=current, to_status=new_status, notes=payload.notes)
    _notify(f"vendor.document.{new_status}",
            {**exists[0], "document_id": document_id, "status": new_status, "reviewed_by": identity.user_id})
    return ok({"document_id": document_id, "status": new_status})
