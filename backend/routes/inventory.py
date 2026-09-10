"""Inventory: stock levels, barcode lookup, regulatory status, transactions."""
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.core.http import Identity, get_identity, ok, DomainError
from backend.database.bigquery_writer import BigQueryWriter
from backend.services.inventory_service import InventoryService
from backend.services.policy_engine import EvaluationContext, PolicyEngine

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"])


def get_services():
    inv = InventoryService()
    writer = BigQueryWriter(inv.bq)
    policy = PolicyEngine(inv.bq)
    return inv, policy, writer


# ----------------------------------------------------------------------
# Reads
# ----------------------------------------------------------------------
@router.get("")
def list_inventory(
    hospital_id: str = Query("H001"),
    antibiotic_id: Optional[str] = None,
    status: Optional[str] = None,
    services=Depends(get_services),
):
    inv, _, _ = services
    rows = inv.list_inventory(hospital_id=hospital_id, antibiotic_id=antibiotic_id)
    if status and status.lower() != "all":
        rows = [r for r in rows if r.get("status") == status.lower()]
    return ok(rows, count=len(rows))


@router.get("/barcode/{barcode_value}")
def lookup_barcode(
    barcode_value: str,
    hospital_id: str = Query("H001"),
    services=Depends(get_services),
):
    inv, _, _ = services
    result = inv.lookup_barcode(barcode_value, hospital_id=hospital_id)
    if not result:
        raise DomainError(
            "MEDICINE_NOT_FOUND",
            "This barcode is not registered in the active medicine catalog.",
            status_code=404,
        )
    return ok(result)


@router.get("/{antibiotic_id}")
def inventory_item(
    antibiotic_id: str,
    hospital_id: str = Query("H001"),
    services=Depends(get_services),
):
    inv, _, _ = services
    item = inv.get_inventory_item(antibiotic_id, hospital_id=hospital_id)
    if not item:
        raise DomainError(
            "MEDICINE_NOT_FOUND", "Medicine could not be found.", status_code=404
        )
    return ok(item)


@router.get("/{antibiotic_id}/regulatory-status")
def regulatory_status(
    antibiotic_id: str,
    quantity: float = Query(1.0, ge=0),
    identity: Identity = Depends(get_identity),
    services=Depends(get_services),
):
    _, policy, _ = services
    ctx = EvaluationContext(
        user_id=identity.user_id,
        user_role=identity.role,
        department_code=identity.department_code,
        antibiotic_id=antibiotic_id,
        quantity=quantity,
    )
    return ok(policy.evaluate(ctx).to_dict())


# ----------------------------------------------------------------------
# Writes
# ----------------------------------------------------------------------
class IssueRequest(BaseModel):
    antibiotic_id: str
    quantity: float = 1.0
    department_code: Optional[str] = None
    allocation_id: Optional[str] = None
    batch_number: Optional[str] = None
    barcode: Optional[str] = None
    unit: str = "vials"
    notes: Optional[str] = None
    event_id: Optional[str] = None
    has_documentation: bool = False
    has_approval: bool = False


@router.post("/transactions")
def create_transaction(
    payload: IssueRequest,
    identity: Identity = Depends(get_identity),
    services=Depends(get_services),
):
    inv, policy, writer = services
    department_code = payload.department_code or identity.department_code
    event_id = payload.event_id or f"EVT-{uuid.uuid4().hex}"
    transaction_id = f"TXN-{uuid.uuid4().hex}"

    # Idempotency: repeated submit of same event returns the original transaction.
    existing = writer.find_transaction_by_event(event_id)
    if existing:
        return ok(
            {
                "transaction_id": existing,
                "event_id": event_id,
                "duplicate": True,
                "message": "This issue was already recorded.",
            }
        )

    ctx = EvaluationContext(
        user_id=identity.user_id,
        user_role=identity.role,
        department_code=department_code,
        antibiotic_id=payload.antibiotic_id,
        quantity=payload.quantity,
        has_documentation=payload.has_documentation,
        has_approval=payload.has_approval,
    )
    decision = policy.evaluate(ctx)

    if decision.decision != "ALLOW":
        writer.record_audit_event({
            "event_id": f"AUD-{uuid.uuid4().hex}",
            "hospital_id": identity.hospital_id,
            "event_type": "medicine.issue_blocked"
            if decision.decision == "BLOCKED"
            else "policy.approval_required",
            "entity_type": "antibiotic",
            "entity_id": payload.antibiotic_id,
            "actor_id": identity.user_id,
            "actor_role": identity.role,
            "action": "ISSUE_MEDICINE",
            "result": "blocked" if decision.decision == "BLOCKED" else "pending_approval",
            "reason": decision.block_reason,
            "transaction_id": transaction_id,
        })
        code = "MEDICINE_ISSUE_BLOCKED" if decision.decision == "BLOCKED" else "APPROVAL_REQUIRED"
        status_code = 403 if decision.decision == "BLOCKED" else 409
        raise DomainError(code, decision.block_reason or "This issue is not permitted.", status_code)

    txn = {
        "transaction_id": transaction_id,
        "event_id": event_id,
        "hospital_id": identity.hospital_id,
        "antibiotic_id": payload.antibiotic_id,
        "department_id": f"DEPT-{department_code}",
        "batch_number": payload.batch_number,
        "barcode_scanned": payload.barcode,
        "transaction_type": "issue",
        "quantity": payload.quantity,
        "unit": payload.unit,
        "performed_by": identity.user_id,
        "performed_by_role": identity.role,
        "policy_id": decision.policy_id,
        "policy_result": "compliant",
        "policy_block_reason": None,
        "notes": payload.notes or "Department dispensing",
    }
    write_result = writer.record_transaction(txn)
    if not write_result.get("success"):
        raise DomainError("TRANSACTION_WRITE_FAILED", "The issue could not be recorded.", 502)

    if payload.allocation_id:
        try:
            writer.apply_allocation_consumption(payload.allocation_id, payload.quantity)
        except Exception:  # noqa: BLE001 - allocation update is best-effort here
            pass

    writer.record_audit_event({
        "event_id": f"AUD-{uuid.uuid4().hex}",
        "hospital_id": identity.hospital_id,
        "event_type": "medicine.issued",
        "entity_type": "antibiotic",
        "entity_id": payload.antibiotic_id,
        "actor_id": identity.user_id,
        "actor_role": identity.role,
        "action": "ISSUE_MEDICINE",
        "result": "success",
        "transaction_id": transaction_id,
    })

    return ok({
        "transaction_id": transaction_id,
        "event_id": event_id,
        "duplicate": write_result.get("duplicate", False),
        "policy_status": decision.status,
        "message": "Medicine issue recorded successfully.",
    })
