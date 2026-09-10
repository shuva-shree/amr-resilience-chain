"""What-if scenario simulation — BigQuery-informed (current stock + supplier lead times)."""
from typing import Optional

from fastapi import APIRouter, Depends
from google.cloud import bigquery
from pydantic import BaseModel

from backend.core.http import DomainError, ok
from backend.database.bigquery_client import bq_manager

router = APIRouter(prefix="/api/v1/scenarios", tags=["scenarios"])


PRESETS = [
    {"id": "demand_surge", "name": "Sepsis outbreak (+50% demand)", "demand_surge_pct": 0.5, "lead_time_delay_days": 0},
    {"id": "supplier_delay", "name": "Primary supplier delayed 14 days", "demand_surge_pct": 0.0, "lead_time_delay_days": 14},
    {"id": "combined", "name": "Surge + supplier disruption", "demand_surge_pct": 0.35, "lead_time_delay_days": 21},
]


class SimRequest(BaseModel):
    hospital_id: str = "H001"
    antibiotic_id: str = "ANT-MERO"
    demand_surge_pct: float = 0.0        # 0.5 == +50%
    lead_time_delay_days: int = 0
    disabled_supplier_id: Optional[str] = None


@router.get("/presets")
def presets():
    return ok(PRESETS)


@router.post("/simulate")
def simulate(payload: SimRequest):
    inv_sql = f"""
        SELECT quantity_on_hand, daily_consumption, reorder_point, safety_stock, unit, inventory_date
        FROM {bq_manager.table('antibiotic_inventory')}
        WHERE hospital_id = @h AND antibiotic_id = @a
        ORDER BY inventory_date DESC
        LIMIT 1
    """
    params = [
        bigquery.ScalarQueryParameter("h", "STRING", payload.hospital_id),
        bigquery.ScalarQueryParameter("a", "STRING", payload.antibiotic_id),
    ]
    inv_rows = bq_manager.query(inv_sql, params)
    if not inv_rows:
        raise DomainError("NO_INVENTORY", "No inventory record exists for this hospital and medicine.", 404)
    inv = inv_rows[0]

    sup_sql = f"""
        SELECT sa.supplier_id, s.supplier_name, sa.lead_time_days, sa.allocation_share, sa.is_primary_supplier
        FROM {bq_manager.table('supplier_antibiotics')} sa
        LEFT JOIN {bq_manager.table('suppliers')} s ON sa.supplier_id = s.supplier_id
        WHERE sa.antibiotic_id = @a
        ORDER BY sa.is_primary_supplier DESC, sa.allocation_share DESC
    """
    suppliers = bq_manager.query(sup_sql, [bigquery.ScalarQueryParameter("a", "STRING", payload.antibiotic_id)])
    active = [s for s in suppliers if s["supplier_id"] != payload.disabled_supplier_id]
    if not active:
        active = suppliers  # can't disable the only supplier

    base_lead = active[0]["lead_time_days"] if active else 14
    effective_lead = base_lead + max(0, payload.lead_time_delay_days)

    on_hand = float(inv["quantity_on_hand"] or 0)
    base_burn = float(inv["daily_consumption"] or 0) or 1.0
    scenario_burn = base_burn * (1 + max(0.0, payload.demand_surge_pct))
    safety_stock = float(inv["safety_stock"] or 0)

    base_days = round(on_hand / base_burn, 1)
    scenario_days = round(on_hand / scenario_burn, 1)
    coverage_gap = round(scenario_days - effective_lead, 1)

    if coverage_gap < 0:
        risk = "CRITICAL"
    elif coverage_gap < 7:
        risk = "HIGH"
    elif coverage_gap < 14:
        risk = "MODERATE"
    else:
        risk = "LOW"

    shortfall_units = max(0.0, (effective_lead - scenario_days) * scenario_burn)
    recommended_order = round(shortfall_units + safety_stock) if shortfall_units > 0 else 0

    return ok({
        "inputs": payload.dict(),
        "as_of": inv["inventory_date"],
        "unit": inv["unit"],
        "current_stock": on_hand,
        "baseline": {
            "daily_consumption": round(base_burn, 1),
            "days_to_depletion": base_days,
            "replenishment_lead_time_days": base_lead,
        },
        "scenario": {
            "daily_consumption": round(scenario_burn, 1),
            "days_to_depletion": scenario_days,
            "replenishment_lead_time_days": effective_lead,
            "coverage_gap_days": coverage_gap,
            "risk_level": risk,
            "recommended_buffer_order": recommended_order,
        },
        "suppliers": active,
        "disabled_supplier_id": payload.disabled_supplier_id,
        "note": "Projection based on the latest BigQuery inventory snapshot and supplier lead times. Requires human review before procurement action.",
    })
