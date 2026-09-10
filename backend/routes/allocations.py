"""Department allocation listing + creation."""
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.core.http import Identity, get_identity, ok, DomainError
from backend.database.bigquery_writer import BigQueryWriter
from backend.services.inventory_service import InventoryService

router = APIRouter(prefix="/api/v1/department-allocations", tags=["allocations"])

_ALLOC_MANAGER_ROLES = {"chief_pharmacist", "pharmacy_manager", "admin"}


def get_services():
    inv = InventoryService()
    return inv, BigQueryWriter(inv.bq)


class AllocationRequest(BaseModel):
    department_id: str
    antibiotic_id: str
    allocated_quantity: float
    allocation_period_start: Optional[str] = None
    allocation_period_end: Optional[str] = None
    demand_forecast_30d: Optional[float] = None
    reorder_threshold: Optional[float] = None
    unit: str = "vials"


@router.get("")
def list_allocations(
    hospital_id: str = Query("H001"),
    antibiotic_id: Optional[str] = None,
    department_code: Optional[str] = None,
    services=Depends(get_services),
):
    inv, _ = services
    rows = inv.get_allocations(
        hospital_id=hospital_id, antibiotic_id=antibiotic_id, department_code=department_code
    )
    return ok(rows, count=len(rows))


@router.post("")
def create_allocation(
    payload: AllocationRequest,
    identity: Identity = Depends(get_identity),
    services=Depends(get_services),
):
    inv, writer = services

    if identity.role not in _ALLOC_MANAGER_ROLES:
        raise DomainError(
            "NOT_AUTHORIZED",
            "Your role is not permitted to create department allocations.",
            status_code=403,
        )

    dept = inv.get_department(payload.department_id)
    if not dept:
        raise DomainError("DEPARTMENT_NOT_FOUND", "Department does not exist.", 404)
    if dept["hospital_id"] != identity.hospital_id:
        raise DomainError("DEPARTMENT_NOT_FOUND", "Department not in this hospital.", 404)

    on_hand = inv.list_inventory(
        hospital_id=identity.hospital_id, antibiotic_id=payload.antibiotic_id
    )
    if not on_hand:
        raise DomainError("MEDICINE_NOT_FOUND", "Medicine has no hospital inventory record.", 404)
    available = on_hand[0].get("quantity_on_hand") or 0
    if payload.allocated_quantity > available:
        raise DomainError(
            "INSUFFICIENT_INVENTORY",
            f"Requested allocation ({payload.allocated_quantity}) exceeds hospital stock ({available}).",
            409,
        )

    allocation_id = f"ALLOC-{uuid.uuid4().hex[:10]}"
    row = {
        "allocation_id": allocation_id,
        "hospital_id": identity.hospital_id,
        "department_id": payload.department_id,
        "antibiotic_id": payload.antibiotic_id,
        "allocation_period_start": payload.allocation_period_start or date.today().isoformat(),
        "allocation_period_end": payload.allocation_period_end,
        "allocated_quantity": payload.allocated_quantity,
        "reserved_quantity": 0.0,
        "consumed_quantity": 0.0,
        "reorder_threshold": payload.reorder_threshold,
        "demand_forecast_30d": payload.demand_forecast_30d,
        "risk_level": "MEDIUM",
        "allocation_status": "active",
        "unit": payload.unit,
        "created_by": identity.user_id,
    }
    result = writer.stream_insert("department_allocations", [row])
    if not result.get("success"):
        raise DomainError("ALLOCATION_WRITE_FAILED", "Allocation could not be saved.", 502)

    writer.record_audit_event({
        "event_id": f"AUD-{uuid.uuid4().hex}",
        "hospital_id": identity.hospital_id,
        "event_type": "allocation.changed",
        "entity_type": "department",
        "entity_id": payload.department_id,
        "actor_id": identity.user_id,
        "actor_role": identity.role,
        "action": "CREATE_ALLOCATION",
        "result": "success",
        "after_state": f'{{"allocation_id":"{allocation_id}","antibiotic_id":"{payload.antibiotic_id}"}}',
    })
    return ok({"allocation_id": allocation_id, "message": "Allocation created."})
