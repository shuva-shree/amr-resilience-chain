"""
Dependency Analysis Agent
Executes recursive graph traversal to trace single points of failure.
"""

from typing import Any, Dict, List
from backend.database.bigquery_client import bq_manager

class DependencyAgent:
    def __init__(self):
        self.name = "Dependency Analysis Agent"

    def trace_upstream(self, hospital_id: str, antibiotic_id: str) -> List[Dict[str, Any]]:
        """Execute recursive graph trace query."""
        return bq_manager.trace_upstream_supply_graph(hospital_id, antibiotic_id)

    def run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        hospital_id = payload.get("hospital_id", "H001")
        antibiotic_id = payload.get("antibiotic_id", "ANT-MERO")
        
        graph = self.trace_upstream(hospital_id, antibiotic_id)
        
        return {
            "agent": self.name,
            "hospital_id": hospital_id,
            "antibiotic_id": antibiotic_id,
            "graph_depth": len(graph),
            "dependency_tree": graph
        }

dependency_agent = DependencyAgent()