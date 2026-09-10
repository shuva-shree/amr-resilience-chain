-- Migration 004: Department Allocations
-- Tracks per-department antibiotic stock allocations with demand context

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.department_allocations` (
  allocation_id             STRING    NOT NULL,
  hospital_id               STRING    NOT NULL,
  department_id             STRING    NOT NULL,   -- FK -> departments.department_id
  antibiotic_id             STRING    NOT NULL,   -- FK -> antibiotics.antibiotic_id
  allocation_period_start   DATE      NOT NULL,
  allocation_period_end     DATE,
  allocated_quantity        FLOAT64   NOT NULL,
  reserved_quantity         FLOAT64   DEFAULT 0.0,
  consumed_quantity         FLOAT64   DEFAULT 0.0,
  reorder_threshold         FLOAT64,
  demand_forecast_30d       FLOAT64,              -- from ML model output
  coverage_days             FLOAT64,              -- derived: (allocated - consumed) / daily_rate
  risk_level                STRING,               -- LOW | MEDIUM | HIGH | CRITICAL
  allocation_status         STRING    DEFAULT 'active',  -- active | expired | cancelled
  unit                      STRING,
  created_by                STRING,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
