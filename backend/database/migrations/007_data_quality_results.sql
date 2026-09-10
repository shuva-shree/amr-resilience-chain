-- Migration 007: Data Quality Results
-- Records outputs of automated data quality checks

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.data_quality_results` (
  check_id          STRING    NOT NULL,
  check_timestamp   TIMESTAMP NOT NULL,
  check_name        STRING    NOT NULL,   -- e.g. inventory_negative_stock, transaction_missing_user
  target_table      STRING    NOT NULL,
  records_checked   INT64,
  records_passed    INT64,
  records_failed    INT64,
  failure_details   STRING,              -- JSON array: [{row_id, field, issue, value}, ...]
  check_status      STRING    NOT NULL,  -- passed | failed | warning | error
  severity          STRING,              -- info | warning | error | critical
  run_by            STRING    DEFAULT 'system',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
