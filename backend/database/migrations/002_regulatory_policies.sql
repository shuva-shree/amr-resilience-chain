-- Migration 002: Medicine Regulatory Policies
-- Configurable restriction rules per antibiotic (data-driven, not hardcoded law)

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.medicine_regulatory_policies` (
  policy_id                STRING    NOT NULL,
  antibiotic_id            STRING    NOT NULL,   -- FK -> antibiotics.antibiotic_id
  policy_name              STRING    NOT NULL,
  jurisdiction             STRING,               -- WHO | IN-CDSCO | hospital_internal
  restriction_level        STRING    NOT NULL,   -- unrestricted | restricted | controlled | reserve
  -- mirrors antibiotics.aware_category (Access / Watch / Reserve / Not Recommended)
  aware_category_override  STRING,
  requires_prescription    BOOL      DEFAULT FALSE,
  requires_approval        BOOL      DEFAULT FALSE,   -- needs senior pharmacist/CMO sign-off
  requires_documentation   BOOL      DEFAULT FALSE,   -- needs clinical justification form
  -- JSON arrays stored as STRING for BigQuery compatibility
  authorized_department_codes STRING,   -- JSON: ["ICU","ED","PHARM"] or null = all
  authorized_roles            STRING,   -- JSON: ["pharmacist","chief_pharmacist"] or null = all
  max_issue_quantity          FLOAT64,
  max_issue_unit              STRING,
  audit_required              BOOL      DEFAULT TRUE,
  policy_effective_date       DATE,
  policy_source               STRING,   -- regulatory reference or internal policy doc ID
  notes                       STRING,
  is_active                   BOOL      DEFAULT TRUE,
  created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
