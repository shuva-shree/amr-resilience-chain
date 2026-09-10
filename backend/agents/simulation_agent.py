"""
Scenario Simulation Agent
Models stock depletion timelines under dynamic market stress.
"""

from typing import Any, Dict

class SimulationAgent:
    def __init__(self):
        self.name = "Scenario Simulation Agent"

    def run_scenario(self, hospital_id: str, antibiotic_id: str, surge_pct: float, delay_days: int) -> Dict[str, Any]:
        """Calculates projected depletion days based on scenario parameters."""
        base_lead_time = 14
        effective_lead_time = base_lead_time + delay_days
        
        # Simple depletion estimation formula:
        baseline_days = 20
        projected_days = max(1, int(baseline_days / (1 + surge_pct)) - (delay_days // 2))
        
        risk_level = "CRITICAL" if projected_days <= 7 else ("WARNING" if projected_days <= 14 else "STABLE")

        return {
            "effective_lead_time_days": effective_lead_time,
            "projected_days_to_depletion": projected_days,
            "risk_escalation": risk_level
        }

    def run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        h_id = payload.get("hospital_id", "H001")
        a_id = payload.get("antibiotic_id", "ANT-MERO")
        surge = payload.get("demand_surge_pct", 0.0)
        delay = payload.get("lead_time_delay_days", 0)

        results = self.run_scenario(h_id, a_id, surge, delay)

        return {
            "agent": self.name,
            "scenario": {
                "hospital_id": h_id,
                "antibiotic_id": a_id,
                "demand_surge_pct": surge,
                "lead_time_delay_days": delay
            },
            "impact": results
        }

simulation_agent = SimulationAgent()