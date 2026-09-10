"""
Ingestion control plane:
  * Module 1 — GLASS monthly agent: trigger + run history
  * Module 2 — hospital feeds: REST push, FHIR push, machine webhook,
               GCS bucket-drop processing + Eventarc handler, batch history
"""
import json
import os
import threading
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Body, Depends, Header, Query
from google.cloud import bigquery
from pydantic import BaseModel

from backend.core import storage
from backend.core.http import DomainError, Identity, ok, require_admin, require_auth
from backend.database.bigquery_client import bq_manager as bq
from backend.jobs import glass_ingest, hospital_ingest

router = APIRouter(prefix="/api/v1/ingestion", tags=["ingestion"])

_HOSPITAL_INGEST_KEY = os.getenv("HOSPITAL_INGEST_KEY", "dev-hospital-ingest-key")


# ======================================================================
# Module 1 — GLASS
# ======================================================================
class GlassRunRequest(BaseModel):
    region: Optional[str] = None
    infection_type: Optional[str] = None
    pathogen: Optional[str] = None
    antibiotic: Optional[str] = None
    scrape: bool = True


@router.post("/glass/run", status_code=202)
def trigger_glass_run(payload: GlassRunRequest, identity: Identity = Depends(require_admin)):
    query = payload.dict(exclude={"scrape"})

    def _bg():
        try:
            glass_ingest.run(query=query, run_type="manual", triggered_by=identity.user_id, do_scrape=payload.scrape)
        except Exception:  # noqa: BLE001 - job records its own failure row
            pass

    threading.Thread(target=_bg, daemon=True).start()
    return ok({
        "status": "accepted",
        "message": "GLASS ingestion started. Track progress in the run history.",
        "query": query,
    })


@router.get("/glass/runs")
def glass_runs(limit: int = Query(25, ge=1, le=200), identity: Identity = Depends(require_admin)):
    glass_ingest.mark_stale_runs(bq)  # self-heal runs stuck in 'running'
    rows = bq.query(f"""
        SELECT run_id, run_type, status, started_at, finished_at, query_params,
               files_downloaded, rows_ingested, rows_deduplicated, dataset_version,
               error, triggered_by, raw_object_uris
        FROM {bq.table('glass_ingestion_runs')}
        ORDER BY started_at DESC
        LIMIT @limit
    """, [bigquery.ScalarQueryParameter("limit", "INT64", limit)])
    return ok(rows, count=len(rows))


@router.get("/glass/runs/{run_id}")
def glass_run(run_id: str, identity: Identity = Depends(require_admin)):
    rows = bq.query(
        f"SELECT * FROM {bq.table('glass_ingestion_runs')} WHERE run_id = @id LIMIT 1",
        [bigquery.ScalarQueryParameter("id", "STRING", run_id)],
    )
    if not rows:
        raise DomainError("NOT_FOUND", "Run not found.", 404)
    return ok(rows[0])


# ======================================================================
# Module 2 — hospital feeds
# ======================================================================
def _records_from_body(body: Union[List[Dict[str, Any]], Dict[str, Any]]) -> List[Dict[str, Any]]:
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        if body.get("resourceType") == "Bundle":
            return hospital_ingest.fhir_bundle_to_records(body)
        if "records" in body and isinstance(body["records"], list):
            return body["records"]
        return [body]
    raise DomainError("INVALID_PAYLOAD", "Expected a JSON array or {records:[...]} / FHIR Bundle.", 400)


@router.post("/hospital/records")
def hospital_records(
    body: Union[List[Dict[str, Any]], Dict[str, Any]] = Body(...),
    hospital_id: Optional[str] = Query(None),
    identity: Identity = Depends(require_auth),
):
    records = _records_from_body(body)
    if not records:
        raise DomainError("NO_RECORDS", "No lab records found in the payload.", 400)
    result = hospital_ingest.process_records(
        records, source="rest_api",
        hospital_id=hospital_id or identity.hospital_id, submitted_by=identity.user_id,
    )
    return ok(result)


@router.post("/hospital/fhir")
def hospital_fhir(bundle: Dict[str, Any] = Body(...), identity: Identity = Depends(require_auth)):
    if bundle.get("resourceType") != "Bundle":
        raise DomainError("NOT_A_BUNDLE", "Expected a FHIR R4 Bundle.", 400)
    records = hospital_ingest.fhir_bundle_to_records(bundle)
    if not records:
        raise DomainError("NO_OBSERVATIONS", "Bundle contained no usable Observation resources.", 400)
    result = hospital_ingest.process_records(
        records, source="fhir", hospital_id=identity.hospital_id, submitted_by=identity.user_id,
    )
    return ok(result)


@router.post("/hospital/webhook")
def hospital_webhook(
    body: Union[List[Dict[str, Any]], Dict[str, Any]] = Body(...),
    x_ingest_key: Optional[str] = Header(None),
    hospital_id: Optional[str] = Query(None),
):
    """Machine-to-machine endpoint for HIS/LIS systems. Authenticated by a shared key."""
    if x_ingest_key != _HOSPITAL_INGEST_KEY:
        raise DomainError("INVALID_INGEST_KEY", "Invalid or missing X-Ingest-Key.", 401)
    records = _records_from_body(body)
    if not records:
        raise DomainError("NO_RECORDS", "No lab records found in the payload.", 400)
    result = hospital_ingest.process_records(
        records, source="rest_api", hospital_id=hospital_id or "H001", submitted_by="his-webhook",
    )
    return ok(result)


@router.post("/hospital/process-drops")
def process_drops(prefix: str = Query("", description="optional key prefix"),
                  identity: Identity = Depends(require_admin)):
    return ok(hospital_ingest.process_bucket_drops(prefix=prefix))


@router.post("/hospital/eventarc")
def eventarc_handler(event: Dict[str, Any] = Body(...)):
    """GCS 'object finalize' handler (Eventarc / Pub/Sub push).

    Accepts the CloudEvent-style body or a raw GCS notification. No user auth —
    protect with Eventarc's OIDC / an ingress key at the infra layer.
    """
    name = (event.get("name")
            or event.get("data", {}).get("name")
            or (event.get("message", {}).get("attributes", {}) or {}).get("objectId"))
    bucket = (event.get("bucket")
              or event.get("data", {}).get("bucket")
              or (event.get("message", {}).get("attributes", {}) or {}).get("bucketId"))
    if not name:
        raise DomainError("NO_OBJECT", "Event did not name a storage object.", 400)
    if bucket and bucket not in ("", storage.HOSPITAL_BUCKET):
        return ok({"skipped": True, "reason": f"bucket {bucket} is not the hospital staging bucket"})
    if not name.lower().endswith((".json", ".csv")):
        return ok({"skipped": True, "reason": "unsupported file type"})
    return ok(hospital_ingest.process_drop_object(name))


@router.get("/hospital/batches")
def hospital_batches(limit: int = Query(50, ge=1, le=200), identity: Identity = Depends(require_admin)):
    rows = bq.query(f"""
        SELECT batch_id, source, hospital_id, received_at, object_uri, record_count,
               accepted_count, rejected_count, pii_fields_removed, status, error, submitted_by
        FROM {bq.table('hospital_ingestion_batches')}
        ORDER BY received_at DESC
        LIMIT @limit
    """, [bigquery.ScalarQueryParameter("limit", "INT64", limit)])
    for r in rows:
        if isinstance(r.get("pii_fields_removed"), str):
            try:
                r["pii_fields_removed"] = json.loads(r["pii_fields_removed"])
            except (ValueError, TypeError):
                pass
    return ok(rows, count=len(rows))
