"""Risk & recommendations — a ranked, actionable list derived from BigQuery signals."""
from fastapi import APIRouter, Query

from backend.core.http import ok
from backend.database.bigquery_client import bq_manager
from backend.services.inventory_service import InventoryService

router = APIRouter(prefix="/api/v1/recommendations", tags=["recommendations"])

_SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MODERATE": 2, "LOW": 3}


@router.get("")
def recommendations(hospital_id: str = Query("H001")):
    items = []

    # 1. Modelled stockout risk (predictions view)
    for p in bq_manager.get_live_predictions(threshold=0.0, hospital_id=hospital_id, limit=100):
        prob = p["stockout_probability_30d"]
        if prob < 0.2 and (p["predicted_days_remaining"] or 999) > 45:
            continue
        sev = p["risk_category"]
        items.append({
            "id": f"risk-{p['antibiotic_id']}",
            "category": "Stockout risk",
            "severity": sev,
            "title": f"{p['antibiotic_name'] or p['antibiotic_id']} — {round(prob * 100)}% 30-day stockout probability",
            "detail": f"Modelled coverage ~{p['predicted_days_remaining']} days at {p['hospital_name'] or hospital_id}.",
            "recommended_action": "Review inventory and confirm the next replenishment order covers the forecast window.",
            "antibiotic_id": p["antibiotic_id"],
        })

    # 2. Failover / reorder recommendations (resilience view)
    for f in bq_manager.get_failover_alerts(hospital_id=hospital_id):
        items.append({
            "id": f"order-{f['antibiotic_id']}-{f['failover_supplier']}",
            "category": "Replenishment",
            "severity": "HIGH" if f["stockout_flag"] else "MODERATE",
            "title": f"Order ~{round(f['recommended_order_vials'])} vials of {f['antibiotic_name'] or f['antibiotic_id']}",
            "detail": (
                f"Failover supplier {f['failover_supplier']} · lead time {f['lead_time_days']} d · "
                f"min order {f['minimum_order_quantity']}."
            ),
            "recommended_action": f"Raise a purchase order with {f['failover_supplier']}.",
            "antibiotic_id": f["antibiotic_id"],
        })

    # 3. Department allocations running low on coverage
    try:
        for a in InventoryService().get_allocations(hospital_id=hospital_id):
            cov = a.get("calculated_coverage_days")
            if cov is not None and cov < 15:
                items.append({
                    "id": f"alloc-{a['allocation_id']}",
                    "category": "Department coverage",
                    "severity": "CRITICAL" if cov < 7 else "HIGH",
                    "title": f"{a['department_name']} — {a['antibiotic_name'] or a['antibiotic_id']} coverage {cov} days",
                    "detail": f"Available {a['available_quantity']} {a.get('unit') or 'units'} vs 30-day demand {a['demand_forecast_30d']}.",
                    "recommended_action": "Reallocate stock from a lower-risk department or expedite resupply.",
                    "antibiotic_id": a["antibiotic_id"],
                })
    except Exception:  # noqa: BLE001
        pass

    items.sort(key=lambda x: _SEVERITY_RANK.get(x["severity"], 9))
    return ok(items, count=len(items))
