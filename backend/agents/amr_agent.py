"""
AMR Investigation Agent
Analyzes live stockout risk predictions and pathogen resistance spikes.
"""

from typing import Any, Dict, List
from backend.database.bigquery_client import bq_manager

class AMRAgent:
    def __init__(self):
        self.name = "AMR Investigation Agent"

    def analyze_predictions(self, threshold: float = 0.70, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch high-risk AMR predictions from BigQuery."""
        predictions = bq_manager.get_live_predictions(threshold=threshold, limit=limit)
        return predictions

    def run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        threshold = payload.get("threshold", 0.70)
        predictions = self.analyze_predictions(threshold=threshold)
        
        return {
            "agent": self.name,
            "predictions_found": len(predictions),
            "data": predictions,
            "insights": [
                f"Identified {len(predictions)} critical stockout risk points above {threshold*100}% threshold."
            ]
        }

amr_agent = AMRAgent()