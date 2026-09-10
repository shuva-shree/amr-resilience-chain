"""
Orchestrator Agent powered by Google ADK / Gemini
Uses tool calling to dynamically orchestrate sub-agents.
"""

import os
from typing import Any, Dict
from google import genai
from google.genai import types

from backend.agents.amr_agent import amr_agent
from backend.agents.dependency_agent import dependency_agent
from backend.agents.simulation_agent import simulation_agent

# Initialize Google ADK / GenAI Client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Define ADK Tools wrapper for sub-agents
def fetch_amr_stockout_alerts(threshold: float = 0.70) -> str:
    """Tool: Fetches live hospital stockout risk predictions from BigQuery."""
    res = amr_agent.run({"threshold": threshold})
    return str(res)

def trace_supply_chain_dependencies(hospital_id: str, antibiotic_id: str) -> str:
    """Tool: Traces multi-tier upstream supply chain dependencies and single points of failure."""
    res = dependency_agent.run({"hospital_id": hospital_id, "antibiotic_id": antibiotic_id})
    return str(res)

def run_what_if_simulation(hospital_id: str, demand_surge_pct: float, lead_time_delay_days: int) -> str:
    """Tool: Runs dynamic scenario simulation for supply delays and demand surges."""
    res = simulation_agent.run({
        "hospital_id": hospital_id,
        "demand_surge_pct": demand_surge_pct,
        "lead_time_delay_days": lead_time_delay_days
    })
    return str(res)


class ADKOrchestrator:
    def __init__(self):
        self.model_name = "gemini-2.5-flash"
        self.tools = [
            fetch_amr_stockout_alerts,
            trace_supply_chain_dependencies,
            run_what_if_simulation
        ]

    def process_request(self, user_prompt: str, role: str = "hospital_staff") -> Dict[str, Any]:
        system_instruction = f"""
        You are the AMR Resilience Master Orchestrator serving a user with role '{role}'.
        Analyze the user prompt and decide which tools to call (AMR alerts, dependency tracing, or simulation).
        Synthesize the output into a clear executive summary with recommended actions.
        """

        # Call Gemini with automatic tool execution enabled
        response = client.models.generate_content(
            model=self.model_name,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=self.tools,
                temperature=0.2,
            )
        )

        return {
            "orchestrator": "Google ADK Gemini Orchestrator",
            "role": role,
            "user_prompt": user_prompt,
            "agent_response": response.text
        }

orchestrator = ADKOrchestrator()