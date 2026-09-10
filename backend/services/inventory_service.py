"""
Inventory management service: stock balances, barcode resolution, department
allocation summaries. Read paths only - all writes go through BigQueryWriter via
the route layer.
"""
import logging
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from backend.database.bigquery_client import BigQueryClient
from backend.database.bigquery_writer import BigQueryWriter

logger = logging.getLogger("inventory_service")

DEFAULT_HOSPITAL_ID = "H001"


def _derive_status(days_of_supply: Optional[float], safety_target_days: Optional[float]) -> str:
    if days_of_supply is None:
        return "unknown"
    if days_of_supply < 10:
        return "critical"
    if safety_target_days and days_of_supply < safety_target_days:
        return "warning"
    if days_of_supply < 30:
        return "warning"
    return "optimal"


class InventoryService:
    def __init__(
        self,
        bq_client: Optional[BigQueryClient] = None,
        bq_writer: Optional[BigQueryWriter] = None,
    ):
        self.bq = bq_client or BigQueryClient()
        self.writer = bq_writer or BigQueryWriter(self.bq)

    # ------------------------------------------------------------------
    # Stock levels (hospital-wide, latest snapshot per antibiotic)
    # ------------------------------------------------------------------
    def list_inventory(
        self,
        hospital_id: str = DEFAULT_HOSPITAL_ID,
        antibiotic_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        conditions = ["i.rn = 1", "i.hospital_id = @hospital_id"]
        params = [bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id)]
        if antibiotic_id:
            conditions.append("i.antibiotic_id = @antibiotic_id")
            params.append(bigquery.ScalarQueryParameter("antibiotic_id", "STRING", antibiotic_id))
        where = " AND ".join(conditions)
        sql = f"""
        WITH latest_inv AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY hospital_id, antibiotic_id ORDER BY inventory_date DESC
            ) AS rn
          FROM {self.bq.table('antibiotic_inventory')}
        ),
        primary_supplier AS (
          SELECT sa.antibiotic_id, s.supplier_name,
            ROW_NUMBER() OVER (
              PARTITION BY sa.antibiotic_id
              ORDER BY sa.is_primary_supplier DESC, sa.allocation_share DESC
            ) AS rn
          FROM {self.bq.table('supplier_antibiotics')} sa
          LEFT JOIN {self.bq.table('suppliers')} s ON sa.supplier_id = s.supplier_id
        )
        SELECT
          i.hospital_id,
          i.antibiotic_id,
          a.antibiotic_name,
          a.drug_class,
          a.aware_category,
          i.quantity_on_hand,
          i.unit,
          i.daily_consumption,
          i.reorder_point,
          i.safety_stock,
          i.inventory_date AS as_of_date,
          SAFE_DIVIDE(i.quantity_on_hand, NULLIF(i.daily_consumption, 0)) AS days_of_supply,
          SAFE_DIVIDE(i.safety_stock,   NULLIF(i.daily_consumption, 0)) AS safety_target_days,
          ps.supplier_name AS primary_supplier
        FROM latest_inv i
        JOIN {self.bq.table('antibiotics')} a ON i.antibiotic_id = a.antibiotic_id
        LEFT JOIN primary_supplier ps ON ps.antibiotic_id = i.antibiotic_id AND ps.rn = 1
        WHERE {where}
        ORDER BY days_of_supply ASC
        """
        rows = self.bq.query(sql, params)
        for r in rows:
            r["status"] = _derive_status(r.get("days_of_supply"), r.get("safety_target_days"))
        return rows

    def get_inventory_item(
        self, antibiotic_id: str, hospital_id: str = DEFAULT_HOSPITAL_ID
    ) -> Optional[Dict[str, Any]]:
        rows = self.list_inventory(hospital_id=hospital_id, antibiotic_id=antibiotic_id)
        if not rows:
            return None
        item = rows[0]
        item["department_allocations"] = self._safe_allocations(hospital_id, antibiotic_id)
        return item

    def _safe_allocations(self, hospital_id: str, antibiotic_id: str) -> List[Dict[str, Any]]:
        try:
            return self.get_allocations(hospital_id=hospital_id, antibiotic_id=antibiotic_id)
        except Exception:  # noqa: BLE001 - allocations table may not be provisioned yet
            logger.warning("department_allocations unavailable; returning empty allocation set")
            return []

    # ------------------------------------------------------------------
    # Barcode resolution
    # ------------------------------------------------------------------
    def lookup_barcode(
        self, barcode_value: str, hospital_id: str = DEFAULT_HOSPITAL_ID
    ) -> Optional[Dict[str, Any]]:
        sql = f"""
        SELECT
          b.barcode_value,
          b.barcode_type,
          b.product_name,
          b.manufacturer_name,
          b.strength,
          b.dosage_form,
          b.packaging_unit,
          b.packaging_count,
          a.antibiotic_id,
          a.antibiotic_name,
          a.atc_code,
          a.aware_category,
          a.drug_class,
          p.policy_id,
          p.policy_name,
          p.restriction_level,
          p.requires_approval,
          p.requires_documentation,
          p.requires_prescription
        FROM {self.bq.table('medicine_barcodes')} b
        JOIN {self.bq.table('antibiotics')} a ON b.antibiotic_id = a.antibiotic_id
        LEFT JOIN {self.bq.table('medicine_regulatory_policies')} p
          ON a.antibiotic_id = p.antibiotic_id AND p.is_active = TRUE
        WHERE b.barcode_value = @barcode AND b.is_active = TRUE
        LIMIT 1
        """
        params = [bigquery.ScalarQueryParameter("barcode", "STRING", barcode_value)]
        rows = self.bq.query(sql, params)
        if not rows:
            return None
        result = rows[0]

        inv = self.list_inventory(hospital_id=hospital_id, antibiotic_id=result["antibiotic_id"])
        result["inventory"] = inv[0] if inv else None
        result["total_hospital_stock"] = inv[0]["quantity_on_hand"] if inv else 0
        result["department_allocations"] = self._safe_allocations(
            hospital_id, result["antibiotic_id"]
        )
        return result

    # ------------------------------------------------------------------
    # Department allocations
    # ------------------------------------------------------------------
    def get_allocations(
        self,
        hospital_id: str = DEFAULT_HOSPITAL_ID,
        antibiotic_id: Optional[str] = None,
        department_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        conditions = ["a.allocation_status = 'active'", "a.hospital_id = @hospital_id"]
        params = [bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id)]
        if antibiotic_id:
            conditions.append("a.antibiotic_id = @antibiotic_id")
            params.append(bigquery.ScalarQueryParameter("antibiotic_id", "STRING", antibiotic_id))
        if department_code:
            conditions.append("d.department_code = @department_code")
            params.append(bigquery.ScalarQueryParameter("department_code", "STRING", department_code))
        where = " AND ".join(conditions)
        sql = f"""
        SELECT
          a.allocation_id,
          a.hospital_id,
          a.department_id,
          d.department_code,
          d.department_name,
          a.antibiotic_id,
          ab.antibiotic_name,
          ab.aware_category,
          a.allocated_quantity,
          a.reserved_quantity,
          a.consumed_quantity,
          (a.allocated_quantity - a.consumed_quantity - a.reserved_quantity) AS available_quantity,
          a.demand_forecast_30d,
          a.reorder_threshold,
          ROUND(
            SAFE_DIVIDE(
              (a.allocated_quantity - a.consumed_quantity - a.reserved_quantity),
              SAFE_DIVIDE(a.demand_forecast_30d, 30.0)
            ), 1
          ) AS calculated_coverage_days,
          a.risk_level,
          a.allocation_status,
          a.unit
        FROM {self.bq.table('department_allocations')} a
        JOIN {self.bq.table('departments')} d ON a.department_id = d.department_id
        LEFT JOIN {self.bq.table('antibiotics')} ab ON a.antibiotic_id = ab.antibiotic_id
        WHERE {where}
        ORDER BY ab.antibiotic_name, d.department_code
        """
        return self.bq.query(sql, params)

    def get_allocation_by_id(self, allocation_id: str) -> Optional[Dict[str, Any]]:
        sql = f"""
        SELECT
          a.*,
          (a.allocated_quantity - a.consumed_quantity - a.reserved_quantity) AS available_quantity
        FROM {self.bq.table('department_allocations')} a
        WHERE a.allocation_id = @allocation_id
        LIMIT 1
        """
        params = [bigquery.ScalarQueryParameter("allocation_id", "STRING", allocation_id)]
        rows = self.bq.query(sql, params)
        return rows[0] if rows else None

    def get_department_allocation_summary(
        self, hospital_id: str = DEFAULT_HOSPITAL_ID
    ) -> List[Dict[str, Any]]:
        return self.get_allocations(hospital_id=hospital_id)

    # ------------------------------------------------------------------
    # Departments
    # ------------------------------------------------------------------
    def list_departments(self, hospital_id: str = DEFAULT_HOSPITAL_ID) -> List[Dict[str, Any]]:
        sql = f"""
        SELECT department_id, hospital_id, department_name, department_code,
               department_type, is_active
        FROM {self.bq.table('departments')}
        WHERE hospital_id = @hospital_id AND is_active = TRUE
        ORDER BY department_name
        """
        params = [bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id)]
        return self.bq.query(sql, params)

    def get_department(self, department_ref: str) -> Optional[Dict[str, Any]]:
        """Resolve a department by either its id (``DEPT-ICU``) or its
        code (``ICU``), case-insensitively."""
        sql = f"""
        SELECT department_id, hospital_id, department_name, department_code,
               department_type, is_active
        FROM {self.bq.table('departments')}
        WHERE UPPER(department_id) = UPPER(@ref)
           OR UPPER(department_code) = UPPER(@ref)
        ORDER BY (UPPER(department_id) = UPPER(@ref)) DESC
        LIMIT 1
        """
        params = [bigquery.ScalarQueryParameter("ref", "STRING", department_ref)]
        rows = self.bq.query(sql, params)
        return rows[0] if rows else None
