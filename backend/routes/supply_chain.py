"""Supply-chain graph, failover alerts and purchase orders (read-only)."""
from typing import Optional

from fastapi import APIRouter, Query

from backend.core.http import ok
from backend.database.bigquery_client import bq_manager

router = APIRouter(prefix="/api/v1/supply-chain", tags=["supply-chain"])


@router.get("/nodes")
def supply_nodes():
    rows = bq_manager.get_supply_nodes()
    return ok(rows, count=len(rows))


@router.get("/trace")
def supply_trace(
    hospital_id: str = Query("H001"),
    antibiotic_id: str = Query("ANT-MERO"),
):
    edges = bq_manager.trace_upstream_supply_graph(hospital_id, antibiotic_id)
    return ok(
        {"hospital_id": hospital_id, "antibiotic_id": antibiotic_id, "edges": edges},
        count=len(edges),
    )


@router.get("/failover-alerts")
def failover_alerts(hospital_id: Optional[str] = None):
    rows = bq_manager.get_failover_alerts(hospital_id=hospital_id)
    return ok(rows, count=len(rows))


@router.get("/purchase-orders")
def purchase_orders(hospital_id: Optional[str] = None, limit: int = Query(100, ge=1, le=500)):
    rows = bq_manager.get_purchase_orders(hospital_id=hospital_id, limit=limit)
    return ok(rows, count=len(rows))
