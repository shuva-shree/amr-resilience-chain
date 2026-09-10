-- Migration 001: Hospital Departments
-- Adds configurable department model per hospital

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.departments` (
  department_id     STRING    NOT NULL,
  hospital_id       STRING    NOT NULL,
  department_name   STRING    NOT NULL,   -- e.g. ICU, Emergency, OPD, Pharmacy, Surgery
  department_code   STRING,               -- short code e.g. ICU, ED, OPD, PHARM, SURG
  department_type   STRING,               -- clinical | pharmacy | administrative | support
  is_active         BOOL      DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
