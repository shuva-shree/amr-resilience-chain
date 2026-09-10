"""Read-only dashboard / catalog / prediction endpoints backed by BigQuery."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.core.http import ok
from backend.database.bigquery_client import bq_manager

router = APIRouter(prefix="/api/v1", tags=["dashboard"])


@router.get("/dashboard/summary")
def dashboard_summary():
    return ok(bq_manager.get_dashboard_summary())


@router.get("/hospitals")
def list_hospitals(search: Optional[str] = None, limit: int = Query(100, ge=1, le=500)):
    rows = bq_manager.get_hospitals(search_query=search, limit=limit)
    return ok(rows, count=len(rows))


@router.get("/hospitals/{hospital_id}")
def hospital_details(hospital_id: str):
    details = bq_manager.get_hospital_details(hospital_id)
    if not details:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return ok(details)


@router.get("/antibiotics")
def list_antibiotics():
    rows = bq_manager.get_antibiotics()
    return ok(rows, count=len(rows))


@router.get("/predictions")
def predictions(
    threshold: float = Query(0.0, ge=0.0, le=1.0),
    hospital_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
):
    rows = bq_manager.get_live_predictions(threshold=threshold, hospital_id=hospital_id, limit=limit)
    return ok(rows, count=len(rows))


@router.get("/trends")
def trends(
    hospital_id: str = Query("H001"),
    antibiotic_id: str = Query("ANT-MERO"),
    months: int = Query(12, ge=1, le=60),
):
    rows = bq_manager.get_historical_trends(hospital_id, antibiotic_id, months=months)
    return ok(rows, count=len(rows))


@router.get("/amr/surveillance")
def amr_surveillance():
    rows = bq_manager.get_amr_surveillance()
    return ok(rows, count=len(rows))
