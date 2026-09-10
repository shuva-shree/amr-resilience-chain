"""
Supply Risk Agent
Monitors vendor reliability and supply disruptions.
"""

from typing import Any, Dict, List
from backend.database.bigquery_client import bq_manager

class SupplyAgent:
    def __init__(self):
        self.name = "Supply Risk Agent"

    def check_vendor_health(self, supplier_id: str = None) -> List[Dict[str, Any]]:
        """Query vendor status and supply bottlenecks."""
        query = f"""
        SELECT 
            source_node_id AS supplier_id,
            target_node_id,
            antibiotic_id,
            supply_share_pct,
            lead_time_days
        FROM `{bq_manager.client.project}.amr_resilience.supply_edges`
        """
        if supplier_id:
            query += f" WHERE source_node_id = '{supplier_id}'"
        
        query += " LIMIT 20;"
        return bq_manager.execute_query(query)

    def run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        supplier_id = payload.get("supplier_id")
        edges = self.check_vendor_health(supplier_id)
        
        return {
            "agent": self.name,
            "edges_evaluated": len(edges),
            "supply_network": edges
        }

supply_agent = SupplyAgent()