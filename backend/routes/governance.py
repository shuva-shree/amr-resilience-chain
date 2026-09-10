"""Governance: audit trail + data-quality results."""
from typing import Optional

from fastapi import APIRouter, Query
from google.cloud import bigquery

from backend.core.http import ok, DomainError
from backend.database.bigquery_client import bq_manager
from backend.services.data_quality import DataQualityEngine

router = APIRouter(prefix="/api/v1/governance", tags=["governance"])


@router.get("/audit-events")
def audit_events(
    limit: int = Query(50, ge=1, le=500),
    event_type: Optional[str] = None,
    entity_id: Optional[str] = None,
):
    conditions = []
    params = [bigquery.ScalarQueryParameter("limit", "INT64", limit)]
    if event_type:
        conditions.append("event_type = @event_type")
        params.append(bigquery.ScalarQueryParameter("event_type", "STRING", event_type))
    if entity_id:
        conditions.append("entity_id = @entity_id")
        params.append(bigquery.ScalarQueryParameter("entity_id", "STRING", entity_id))
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = f"""
        SELECT *
        FROM {bq_manager.table('audit_events')}
        {where}
        ORDER BY event_timestamp DESC
        LIMIT @limit
    """
    rows = bq_manager.query(sql, params)
    return ok(rows, count=len(rows))


# Legacy alias kept for the existing frontend path
@router.get("/audit-logs")
def audit_logs(limit: int = Query(50, ge=1, le=500)):
    return audit_events(limit=limit)


@router.get("/data-quality")
def data_quality_results(limit: int = Query(20, ge=1, le=200)):
    sql = f"""
        SELECT *
        FROM {bq_manager.table('data_quality_results')}
        ORDER BY check_timestamp DESC
        LIMIT @limit
    """
    params = [bigquery.ScalarQueryParameter("limit", "INT64", limit)]
    rows = bq_manager.query(sql, params)
    return ok(rows, count=len(rows))


@router.post("/data-quality/run")
def run_data_quality():
    try:
        results = DataQualityEngine().run_all_checks()
    except Exception as exc:  # noqa: BLE001
        raise DomainError(
            "DQ_RUN_FAILED",
            "Data-quality checks could not complete (a target table may be missing).",
            502,
        ) from exc
    return ok(results, count=len(results))
