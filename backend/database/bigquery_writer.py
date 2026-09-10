"""
BigQuery streaming ingestion & transaction writer with idempotency support.

State-changing operations (inventory transactions, audit events, data-quality
results) are written here and nowhere else.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from backend.database.bigquery_client import BigQueryClient

logger = logging.getLogger("bigquery_writer")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BigQueryWriter:
    def __init__(self, bq_client: Optional[BigQueryClient] = None):
        self.bq = bq_client or BigQueryClient()
        self.client = self.bq.client
        self.dataset_id = self.bq.dataset_id
        self.project_id = self.bq.project_id

    def _table_ref(self, table_name: str) -> str:
        return f"{self.project_id}.{self.dataset_id}.{table_name}"

    def stream_insert(self, table_name: str, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        errors = self.client.insert_rows_json(self._table_ref(table_name), rows)
        if errors:
            logger.error("BigQuery insert errors on %s: %s", table_name, errors)
            return {"success": False, "errors": errors}
        return {"success": True, "count": len(rows)}

    # ------------------------------------------------------------------
    def find_transaction_by_event(self, event_id: str) -> Optional[str]:
        sql = f"""
            SELECT transaction_id
            FROM `{self._table_ref('inventory_transactions')}`
            WHERE event_id = @event_id
            LIMIT 1
        """
        params = [bigquery.ScalarQueryParameter("event_id", "STRING", event_id)]
        rows = list(self.client.query(
            sql, job_config=bigquery.QueryJobConfig(query_parameters=params)
        ).result())
        return rows[0].transaction_id if rows else None

    def record_transaction(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Record an inventory transaction idempotently, keyed on event_id."""
        event_id = transaction_data.get("event_id")
        if not event_id:
            return {"success": False, "error": "Missing event_id for transaction"}

        existing = self.find_transaction_by_event(event_id)
        if existing:
            logger.info("Duplicate transaction skipped for event_id=%s", event_id)
            return {"success": True, "duplicate": True, "transaction_id": existing}

        transaction_data.setdefault("transaction_timestamp", _utcnow_iso())
        transaction_data.setdefault("created_at", _utcnow_iso())
        transaction_data.setdefault("source_system", "api")
        result = self.stream_insert("inventory_transactions", [transaction_data])
        result["duplicate"] = False
        result["transaction_id"] = transaction_data.get("transaction_id")
        return result

    def record_audit_event(self, audit_data: Dict[str, Any]) -> Dict[str, Any]:
        audit_data.setdefault("event_timestamp", _utcnow_iso())
        audit_data.setdefault("created_at", _utcnow_iso())
        return self.stream_insert("audit_events", [audit_data])

    def record_dq_result(self, dq_data: Dict[str, Any]) -> Dict[str, Any]:
        dq_data.setdefault("check_timestamp", _utcnow_iso())
        dq_data.setdefault("created_at", _utcnow_iso())
        return self.stream_insert("data_quality_results", [dq_data])

    def apply_allocation_consumption(
        self, allocation_id: str, quantity: float
    ) -> Dict[str, Any]:
        """Increment consumed_quantity on a department allocation (DML)."""
        sql = f"""
            UPDATE `{self._table_ref('department_allocations')}`
            SET consumed_quantity = consumed_quantity + @qty,
                updated_at = CURRENT_TIMESTAMP()
            WHERE allocation_id = @allocation_id
        """
        params = [
            bigquery.ScalarQueryParameter("qty", "FLOAT64", quantity),
            bigquery.ScalarQueryParameter("allocation_id", "STRING", allocation_id),
        ]
        job = self.client.query(
            sql, job_config=bigquery.QueryJobConfig(query_parameters=params)
        )
        job.result()
        return {"success": True, "rows_affected": job.num_dml_affected_rows}
