-- Migration 006: Audit Events
-- Immutable operational audit trail for all state-changing actions

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.audit_events` (
  event_id         STRING    NOT NULL,
  hospital_id      STRING    NOT NULL,
  event_timestamp  TIMESTAMP NOT NULL,
  event_type       STRING    NOT NULL,   -- medicine.issued | medicine.returned | allocation.changed |
                                         -- policy.evaluated | restricted.approved | restricted.blocked |
                                         -- purchase_order.created | data_quality.failed | ...
  entity_type      STRING,               -- antibiotic | department | purchase_order | policy | system
  entity_id        STRING,
  actor_id         STRING    NOT NULL,   -- user_id or 'system'
  actor_role       STRING,
  action           STRING    NOT NULL,   -- human-readable description
  before_state     STRING,               -- JSON snapshot before change
  after_state      STRING,               -- JSON snapshot after change
  result           STRING,               -- success | blocked | pending_approval | failed | automated
  reason           STRING,               -- why blocked / why approved / error message
  transaction_id   STRING,               -- link back to inventory_transactions if applicable
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
