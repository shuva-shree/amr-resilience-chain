"""Departments + department allocations."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.core.http import Identity, get_identity, ok
from backend.services.inventory_service import InventoryService

router = APIRouter(prefix="/api/v1/departments", tags=["departments"])


def _svc() -> InventoryService:
    return InventoryService()


@router.get("")
def list_departments(hospital_id: str = Query("H001")):
    rows = _svc().list_departments(hospital_id=hospital_id)
    return ok(rows, count=len(rows))


@router.get("/allocations/summary")
def allocation_summary(hospital_id: str = Query("H001")):
    rows = _svc().get_department_allocation_summary(hospital_id=hospital_id)
    return ok(rows, count=len(rows))


@router.get("/{department_id}")
def department_details(department_id: str):
    dept = _svc().get_department(department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return ok(dept)


@router.get("/{department_id}/inventory")
def department_inventory(department_id: str):
    svc = _svc()
    dept = svc.get_department(department_id)
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    rows = svc.get_allocations(
        hospital_id=dept["hospital_id"], department_code=dept["department_code"]
    )
    return ok(rows, count=len(rows))
