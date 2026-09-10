"""
Database Access Layer for BigQuery.

Single source of truth for BigQuery connectivity + all read queries that back the
frontend data feeds. Every query in this module is aligned with the *actual*
`amr_resilience` dataset schema (verified against INFORMATION_SCHEMA), not the
historical/aspirational column names that older code assumed.
"""

import os
import datetime
import decimal
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

PROJECT_ID = os.getenv("GCP_PROJECT_ID") or os.getenv("GCP_PROJECT") or "patchamomma-2026-505909"
DATASET_ID = os.getenv("BQ_DATASET_ID", "amr_resilience")


def _json_safe(value: Any) -> Any:
    """Convert BigQuery cell values into JSON-serialisable primitives."""
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value


class BigQueryClient:
    """Thin wrapper around ``google.cloud.bigquery.Client``.

    Exposes ``project_id`` / ``dataset_id`` / ``client`` (relied on across the
    services layer) plus a ``query`` helper that returns plain dictionaries.
    """

    def __init__(self, project_id: str = PROJECT_ID, dataset_id: str = DATASET_ID):
        self.project_id = project_id
        self.dataset_id = dataset_id
        self.client = bigquery.Client(project=project_id)

    # ------------------------------------------------------------------
    # Core helpers
    # ------------------------------------------------------------------
    def table(self, name: str) -> str:
        return f"`{self.project_id}.{self.dataset_id}.{name}`"

    def query(
        self,
        sql: str,
        parameters: Optional[List[bigquery.ScalarQueryParameter]] = None,
    ) -> List[Dict[str, Any]]:
        job_config = bigquery.QueryJobConfig(query_parameters=parameters or [])
        rows = self.client.query(sql, job_config=job_config).result()
        return [{k: _json_safe(v) for k, v in dict(row).items()} for row in rows]

    def load_rows(self, table_name: str, rows: List[Dict[str, Any]],
                  write_disposition: str = "WRITE_APPEND") -> None:
        """Insert rows via a load job (no streaming buffer -> row is immediately
        UPDATE-able). Use for low-frequency tables that need later mutation."""
        if not rows:
            return
        job_config = bigquery.LoadJobConfig(
            write_disposition=write_disposition,
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
            schema_update_options=[bigquery.SchemaUpdateOption.ALLOW_FIELD_ADDITION],
        )
        ref = f"{self.project_id}.{self.dataset_id}.{table_name}"
        self.client.load_table_from_json(rows, ref, job_config=job_config).result()

    # Backwards-compatible alias used by some legacy callers
    def execute_query(
        self,
        sql: str,
        parameters: Optional[List[bigquery.ScalarQueryParameter]] = None,
    ) -> List[Dict[str, Any]]:
        return self.query(sql, parameters)

    # ==================================================================
    # 1. Dashboard summary KPIs
    # ==================================================================
    def get_dashboard_summary(self) -> Dict[str, Any]:
        sql = f"""
        WITH latest AS (
          SELECT
            hospital_id,
            antibiotic_id,
            stockout_probability_30d,
            ROW_NUMBER() OVER (
              PARTITION BY hospital_id, antibiotic_id
              ORDER BY feature_date DESC
            ) AS rn
          FROM {self.table('v_live_agent_predictions')}
        )
        SELECT
          (SELECT COUNT(*) FROM {self.table('hospitals')})   AS total_hospitals,
          (SELECT COUNT(*) FROM {self.table('antibiotics')}) AS tracked_antibiotics,
          COUNTIF(stockout_probability_30d >= 0.70)                       AS critical_risk_hospitals,
          COUNTIF(stockout_probability_30d >= 0.40
                  AND stockout_probability_30d < 0.70)                    AS moderate_risk_hospitals,
          ROUND(AVG(stockout_probability_30d) * 100, 2)                   AS avg_stockout_risk_pct
        FROM latest
        WHERE rn = 1
        """
        rows = self.query(sql)
        return rows[0] if rows else {}

    # ==================================================================
    # 2. Master data: hospitals & antibiotics
    # ==================================================================
    def get_hospitals(self, search_query: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        where = ""
        params = [bigquery.ScalarQueryParameter("limit", "INT64", limit)]
        if search_query:
            where = "WHERE LOWER(hospital_name) LIKE @search OR LOWER(city) LIKE @search"
            params.append(bigquery.ScalarQueryParameter("search", "STRING", f"%{search_query.lower()}%"))
        sql = f"""
        SELECT
          hospital_id,
          hospital_name,
          city,
          state_province AS state,
          country,
          facility_type,
          bed_capacity
        FROM {self.table('hospitals')}
        {where}
        ORDER BY hospital_name ASC
        LIMIT @limit
        """
        return self.query(sql, params)

    def get_hospital_details(self, hospital_id: str) -> Optional[Dict[str, Any]]:
        sql = f"""
        WITH latest AS (
          SELECT
            hospital_id, antibiotic_id, stockout_probability_30d,
            days_of_supply, feature_date,
            ROW_NUMBER() OVER (
              PARTITION BY hospital_id, antibiotic_id ORDER BY feature_date DESC
            ) AS rn
          FROM {self.table('v_live_agent_predictions')}
        )
        SELECT
          h.hospital_id,
          h.hospital_name,
          h.city,
          h.state_province AS state,
          h.country,
          h.facility_type,
          h.bed_capacity,
          p.antibiotic_id,
          p.stockout_probability_30d,
          CAST(ROUND(p.days_of_supply) AS INT64) AS predicted_days_remaining,
          p.feature_date AS last_updated
        FROM {self.table('hospitals')} h
        LEFT JOIN latest p
          ON h.hospital_id = p.hospital_id AND p.rn = 1
        WHERE h.hospital_id = @hospital_id
        """
        params = [bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id)]
        rows = self.query(sql, params)
        return rows or None

    def get_antibiotics(self) -> List[Dict[str, Any]]:
        sql = f"""
        SELECT
          antibiotic_id,
          antibiotic_name,
          atc_code,
          drug_class,
          aware_category,
          defined_daily_dose_g,
          route_of_admin
        FROM {self.table('antibiotics')}
        ORDER BY antibiotic_name ASC
        """
        return self.query(sql)

    # ==================================================================
    # 3. Live stockout risk predictions
    # ==================================================================
    def get_live_predictions(
        self,
        threshold: float = 0.70,
        hospital_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        conditions = ["p.stockout_probability_30d >= @threshold"]
        params = [
            bigquery.ScalarQueryParameter("threshold", "FLOAT64", threshold),
            bigquery.ScalarQueryParameter("limit", "INT64", limit),
        ]
        if hospital_id:
            conditions.append("p.hospital_id = @hospital_id")
            params.append(bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id))
        where = " AND ".join(conditions)
        sql = f"""
        WITH latest AS (
          SELECT
            hospital_id, antibiotic_id, stockout_probability_30d,
            days_of_supply, feature_date,
            ROW_NUMBER() OVER (
              PARTITION BY hospital_id, antibiotic_id ORDER BY feature_date DESC
            ) AS rn
          FROM {self.table('v_live_agent_predictions')}
        )
        SELECT
          p.hospital_id,
          h.hospital_name,
          p.antibiotic_id,
          a.antibiotic_name,
          p.stockout_probability_30d,
          CAST(ROUND(p.days_of_supply) AS INT64) AS predicted_days_remaining,
          CASE
            WHEN p.stockout_probability_30d >= 0.70 THEN 'CRITICAL'
            WHEN p.stockout_probability_30d >= 0.40 THEN 'HIGH'
            WHEN p.stockout_probability_30d >= 0.20 THEN 'MODERATE'
            ELSE 'LOW'
          END AS risk_category,
          p.feature_date AS last_updated
        FROM latest p
        LEFT JOIN {self.table('hospitals')} h ON p.hospital_id = h.hospital_id
        LEFT JOIN {self.table('antibiotics')} a ON p.antibiotic_id = a.antibiotic_id
        WHERE p.rn = 1 AND {where}
        ORDER BY p.stockout_probability_30d DESC
        LIMIT @limit
        """
        return self.query(sql, params)

    # ==================================================================
    # 4. Supply chain graph
    # ==================================================================
    def get_supply_nodes(self) -> List[Dict[str, Any]]:
        sql = f"""
        SELECT node_id, node_name, node_type, country
        FROM {self.table('supply_nodes')}
        ORDER BY node_type, node_name
        """
        return self.query(sql)

    def trace_upstream_supply_graph(self, hospital_id: str, antibiotic_id: str) -> List[Dict[str, Any]]:
        sql = f"""
        WITH RECURSIVE upstream AS (
          SELECT
            source_node_id, target_node_id, antibiotic_id,
            supply_share_pct,
            lead_time_days AS total_lead_time,
            1 AS depth
          FROM {self.table('supply_edges')}
          WHERE target_node_id = @hospital_id AND antibiotic_id = @antibiotic_id

          UNION ALL

          SELECT
            e.source_node_id, e.target_node_id, e.antibiotic_id,
            e.supply_share_pct,
            u.total_lead_time + e.lead_time_days AS total_lead_time,
            u.depth + 1
          FROM {self.table('supply_edges')} e
          JOIN upstream u
            ON e.target_node_id = u.source_node_id
           AND e.antibiotic_id = u.antibiotic_id
          WHERE u.depth < 10
        )
        SELECT
          u.source_node_id,
          sn.node_name  AS source_node_name,
          sn.node_type  AS source_node_type,
          u.target_node_id,
          tn.node_name  AS target_node_name,
          tn.node_type  AS target_node_type,
          u.antibiotic_id,
          u.supply_share_pct,
          u.total_lead_time,
          u.depth
        FROM upstream u
        LEFT JOIN {self.table('supply_nodes')} sn ON u.source_node_id = sn.node_id
        LEFT JOIN {self.table('supply_nodes')} tn ON u.target_node_id = tn.node_id
        ORDER BY u.depth, u.supply_share_pct DESC
        """
        params = [
            bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id),
            bigquery.ScalarQueryParameter("antibiotic_id", "STRING", antibiotic_id),
        ]
        return self.query(sql, params)

    # ==================================================================
    # 5. Historical trends (charting)
    # ==================================================================
    def get_historical_trends(
        self,
        hospital_id: str,
        antibiotic_id: str,
        months: int = 12,
    ) -> List[Dict[str, Any]]:
        sql = f"""
        SELECT
          t.observation_date AS snapshot_date,
          COALESCE(p.stockout_probability_30d, 0.0) AS stockout_probability,
          t.inventory_vials AS inventory_units_on_hand,
          t.vials_per_day   AS consumption_rate_daily,
          t.resistance_pct,
          t.usage_ddd_rate
        FROM {self.table('v_amr_usage_trends')} t
        LEFT JOIN {self.table('v_live_agent_predictions')} p
          ON t.hospital_id = p.hospital_id
         AND t.antibiotic_id = p.antibiotic_id
         AND t.observation_date = p.feature_date
        WHERE t.hospital_id = @hospital_id AND t.antibiotic_id = @antibiotic_id
        ORDER BY t.observation_date DESC
        LIMIT @months
        """
        params = [
            bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id),
            bigquery.ScalarQueryParameter("antibiotic_id", "STRING", antibiotic_id),
            bigquery.ScalarQueryParameter("months", "INT64", months),
        ]
        rows = self.query(sql, params)
        return list(reversed(rows))

    # ==================================================================
    # 6. AMR resistance surveillance (formulary catalog)
    # ==================================================================
    def get_amr_surveillance(self) -> List[Dict[str, Any]]:
        sql = f"""
        WITH latest_trend AS (
          SELECT
            antibiotic_id, pathogen_id, resistance_pct, usage_ddd_rate, observation_date,
            ROW_NUMBER() OVER (
              PARTITION BY antibiotic_id, pathogen_id ORDER BY observation_date DESC
            ) AS rn
          FROM {self.table('v_amr_usage_trends')}
        ),
        prev_trend AS (
          SELECT
            antibiotic_id, pathogen_id, resistance_pct, observation_date,
            ROW_NUMBER() OVER (
              PARTITION BY antibiotic_id, pathogen_id ORDER BY observation_date DESC
            ) AS rn
          FROM {self.table('v_amr_usage_trends')}
        )
        SELECT
          a.antibiotic_id,
          a.antibiotic_name,
          a.drug_class,
          a.aware_category,
          pa.pathogen_name AS primary_pathogen,
          lt.resistance_pct,
          lt.usage_ddd_rate,
          ROUND(lt.resistance_pct - pv.resistance_pct, 2) AS resistance_change,
          lt.observation_date AS as_of_date
        FROM {self.table('antibiotics')} a
        LEFT JOIN latest_trend lt ON a.antibiotic_id = lt.antibiotic_id AND lt.rn = 1
        LEFT JOIN prev_trend   pv ON a.antibiotic_id = pv.antibiotic_id AND pv.rn = 2
        LEFT JOIN {self.table('pathogens')} pa ON lt.pathogen_id = pa.pathogen_id
        ORDER BY a.antibiotic_name
        """
        return self.query(sql)

    # ==================================================================
    # 7. Supply-chain resilience / failover alerts
    # ==================================================================
    def get_failover_alerts(self, hospital_id: Optional[str] = None) -> List[Dict[str, Any]]:
        conditions = ["f.rn = 1"]
        params: List[bigquery.ScalarQueryParameter] = []
        if hospital_id:
            conditions.append("f.hospital_id = @hospital_id")
            params.append(bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id))
        where = " AND ".join(conditions)
        sql = f"""
        WITH ranked AS (
          SELECT
            f.*,
            ROW_NUMBER() OVER (
              PARTITION BY f.hospital_id, f.antibiotic_id, f.failover_supplier
              ORDER BY f.inventory_date DESC
            ) AS rn
          FROM {self.table('v_resilience_failover_alerts')} f
        )
        SELECT
          f.inventory_date,
          f.hospital_id,
          f.antibiotic_id,
          a.antibiotic_name,
          f.quantity_on_hand,
          f.daily_consumption,
          f.stockout_flag,
          f.failover_supplier,
          f.lead_time_days,
          f.minimum_order_quantity,
          f.recommended_order_vials
        FROM ranked f
        LEFT JOIN {self.table('antibiotics')} a ON f.antibiotic_id = a.antibiotic_id
        WHERE {where}
        ORDER BY f.stockout_flag DESC, f.lead_time_days ASC
        """
        return self.query(sql, params)

    # ==================================================================
    # 8. Purchase orders
    # ==================================================================
    def get_purchase_orders(self, hospital_id: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        conditions = []
        params = [bigquery.ScalarQueryParameter("limit", "INT64", limit)]
        if hospital_id:
            conditions.append("po.hospital_id = @hospital_id")
            params.append(bigquery.ScalarQueryParameter("hospital_id", "STRING", hospital_id))
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        sql = f"""
        SELECT
          po.purchase_order_id,
          po.hospital_id,
          po.supplier_id,
          s.supplier_name,
          po.antibiotic_id,
          a.antibiotic_name,
          po.order_date,
          po.expected_delivery_date,
          po.quantity_ordered,
          po.quantity_received,
          po.status
        FROM {self.table('purchase_orders')} po
        LEFT JOIN {self.table('suppliers')} s ON po.supplier_id = s.supplier_id
        LEFT JOIN {self.table('antibiotics')} a ON po.antibiotic_id = a.antibiotic_id
        {where}
        ORDER BY po.order_date DESC
        LIMIT @limit
        """
        return self.query(sql, params)


# Global client instance (bigquery.Client construction is lazy - no network I/O here)
bq_manager = BigQueryClient()

# Legacy alias
BigQueryClientManager = BigQueryClient
