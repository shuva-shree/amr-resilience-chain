"""
Regulatory / antimicrobial-stewardship policy engine.

The authorization decision for issuing a restricted medicine lives HERE, on the
server. The frontend only renders the result. Policies are data-driven, read
from ``medicine_regulatory_policies`` in BigQuery - never hardcoded.
"""
import json
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from backend.database.bigquery_client import BigQueryClient

logger = logging.getLogger("policy_engine")


@dataclass
class EvaluationContext:
    user_id: str
    user_role: str
    department_code: str
    antibiotic_id: str
    quantity: float = 1.0
    has_documentation: bool = False
    has_approval: bool = False


@dataclass
class PolicyResult:
    # decision: ALLOW | APPROVAL_REQUIRED | BLOCKED
    decision: str
    status: str                      # COMPLIANT | APPROVAL_REQUIRED | BLOCKED (legacy field)
    policy_id: Optional[str] = None
    policy_name: Optional[str] = None
    restriction_level: str = "unrestricted"
    requires_approval: bool = False
    requires_documentation: bool = False
    requires_prescription: bool = False
    authorized: bool = True
    block_reason: Optional[str] = None
    reasons: Optional[List[str]] = None
    max_issue_quantity: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "decision": self.decision,
            "status": self.status,
            "policyId": self.policy_id,
            "policyName": self.policy_name,
            "restrictionLevel": self.restriction_level,
            "requiresApproval": self.requires_approval,
            "requiresDocumentation": self.requires_documentation,
            "requiresPrescription": self.requires_prescription,
            "authorized": self.authorized,
            "reason": self.block_reason,
            "reasons": self.reasons or [],
            "maxIssueQuantity": self.max_issue_quantity,
        }


def _parse_json_list(raw: Optional[str]) -> Optional[List[str]]:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return [str(x) for x in parsed] if isinstance(parsed, list) else None
    except (json.JSONDecodeError, TypeError):
        return None


class PolicyEngine:
    def __init__(self, bq_client: Optional[BigQueryClient] = None):
        self.bq = bq_client or BigQueryClient()

    def get_active_policy(self, antibiotic_id: str) -> Optional[Dict[str, Any]]:
        sql = f"""
            SELECT *
            FROM {self.bq.table('medicine_regulatory_policies')}
            WHERE antibiotic_id = @antibiotic_id AND is_active = TRUE
            ORDER BY policy_effective_date DESC
            LIMIT 1
        """
        params = [bigquery.ScalarQueryParameter("antibiotic_id", "STRING", antibiotic_id)]
        rows = self.bq.query(sql, params)
        return rows[0] if rows else None

    def evaluate(self, ctx: EvaluationContext) -> PolicyResult:
        policy = self.get_active_policy(ctx.antibiotic_id)

        # No active policy -> unrestricted, allowed.
        if not policy:
            return PolicyResult(
                decision="ALLOW",
                status="COMPLIANT",
                restriction_level="unrestricted",
                reasons=["No active regulatory policy for this medicine."],
            )

        reasons: List[str] = []
        restriction = (policy.get("restriction_level") or "unrestricted").lower()
        allowed_depts = _parse_json_list(policy.get("authorized_department_codes"))
        allowed_roles = _parse_json_list(policy.get("authorized_roles"))
        max_qty = policy.get("max_issue_quantity")

        result = PolicyResult(
            decision="ALLOW",
            status="COMPLIANT",
            policy_id=policy.get("policy_id"),
            policy_name=policy.get("policy_name"),
            restriction_level=restriction,
            requires_approval=bool(policy.get("requires_approval")),
            requires_documentation=bool(policy.get("requires_documentation")),
            requires_prescription=bool(policy.get("requires_prescription")),
            max_issue_quantity=max_qty,
            reasons=reasons,
        )

        # --- Hard blocks -------------------------------------------------
        if allowed_depts and ctx.department_code not in allowed_depts:
            result.decision = "BLOCKED"
            result.status = "BLOCKED"
            result.authorized = False
            result.block_reason = (
                f"Department '{ctx.department_code}' is not authorized for "
                f"{policy.get('policy_name')} (allowed: {', '.join(allowed_depts)})."
            )
            reasons.append(result.block_reason)
            return result

        if allowed_roles and ctx.user_role not in allowed_roles:
            result.decision = "BLOCKED"
            result.status = "BLOCKED"
            result.authorized = False
            result.block_reason = (
                f"Role '{ctx.user_role}' is not authorized to issue this medicine "
                f"(allowed: {', '.join(allowed_roles)})."
            )
            reasons.append(result.block_reason)
            return result

        if max_qty is not None and ctx.quantity > float(max_qty):
            result.decision = "BLOCKED"
            result.status = "BLOCKED"
            result.authorized = False
            result.block_reason = (
                f"Requested quantity {ctx.quantity} exceeds the policy maximum of "
                f"{max_qty} {policy.get('max_issue_unit') or 'units'} per issue."
            )
            reasons.append(result.block_reason)
            return result

        # --- Approval / documentation gates ----------------------------
        if result.requires_documentation and not ctx.has_documentation:
            result.decision = "APPROVAL_REQUIRED"
            result.status = "APPROVAL_REQUIRED"
            result.authorized = False
            reasons.append("Clinical justification / documentation is required before issue.")

        if result.requires_approval and not ctx.has_approval:
            result.decision = "APPROVAL_REQUIRED"
            result.status = "APPROVAL_REQUIRED"
            result.authorized = False
            reasons.append(
                f"{policy.get('policy_name')}: senior pharmacist / CMO approval is required."
            )

        if result.decision == "ALLOW":
            reasons.append("Issue permitted under the active policy.")

        result.block_reason = reasons[-1] if result.decision != "ALLOW" else None
        return result
