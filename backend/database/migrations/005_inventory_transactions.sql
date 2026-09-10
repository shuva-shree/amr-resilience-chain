-- Migration 005: Inventory Transactions
-- Immutable ledger of all stock movements. Idempotency enforced by event_id.

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.inventory_transactions` (
  transaction_id        STRING    NOT NULL,
  event_id              STRING    NOT NULL,   -- idempotency key (unique per real-world event)
  hospital_id           STRING    NOT NULL,
  antibiotic_id         STRING    NOT NULL,
  department_id         STRING,               -- issuing/receiving department
  batch_number          STRING,
  barcode_scanned       STRING,               -- raw barcode value if scanned
  transaction_type      STRING    NOT NULL,   -- receipt | issue | return | transfer | adjustment | write_off
  quantity              FLOAT64   NOT NULL,   -- positive = stock in, negative = stock out
  unit                  STRING    NOT NULL,
  transaction_timestamp TIMESTAMP NOT NULL,
  performed_by          STRING    NOT NULL,   -- user_id or system identifier
  performed_by_role     STRING,
  approved_by           STRING,
  approval_timestamp    TIMESTAMP,
  policy_id             STRING,               -- which policy was evaluated
  policy_result         STRING,               -- compliant | approval_required | blocked
  policy_block_reason   STRING,
  notes                 STRING,
  source_system         STRING    DEFAULT 'manual',  -- manual | barcode_scan | api | scheduled
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
