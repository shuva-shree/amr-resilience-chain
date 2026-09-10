-- 009 seed data. Idempotent: each section clears its table before re-inserting,
-- so `migrate --seed` can be run more than once without duplicating rows.

-- Seed Departments
DELETE FROM `patchamomma-2026-505909.amr_resilience.departments` WHERE TRUE;
INSERT INTO `patchamomma-2026-505909.amr_resilience.departments`
  (department_id, hospital_id, department_name, department_code, department_type, is_active)
VALUES
  ('DEPT-ICU',   'H001', 'Intensive Care Unit',  'ICU',   'clinical',  TRUE),
  ('DEPT-ED',    'H001', 'Emergency Department', 'ED',    'clinical',  TRUE),
  ('DEPT-OPD',   'H001', 'Outpatient Department','OPD',   'clinical',  TRUE),
  ('DEPT-PHARM', 'H001', 'Central Pharmacy',     'PHARM', 'pharmacy',  TRUE),
  ('DEPT-SURG',  'H001', 'Surgical Unit',        'SURG',  'clinical',  TRUE),
  ('DEPT-INFX',  'H001', 'Infection Control',    'INFX',  'clinical',  TRUE);

-- Seed Barcodes
DELETE FROM `patchamomma-2026-505909.amr_resilience.medicine_barcodes` WHERE TRUE;
INSERT INTO `patchamomma-2026-505909.amr_resilience.medicine_barcodes`
  (barcode_id, antibiotic_id, barcode_value, barcode_type, manufacturer_name, product_name, strength, dosage_form, packaging_unit, packaging_count, is_active)
VALUES
  ('BAR-001', 'ANT-MERO', '8901234567890', 'GTIN-13', 'PharmaCore Global', 'Meropenem Injection', '1g', 'Injection', 'vial', 1, TRUE),
  ('BAR-002', 'ANT-MERO', '8901234567891', 'GTIN-13', 'AstraMed Inc', 'Meropenem 1g Vial', '1g', 'Injection', 'vial', 1, TRUE),
  ('BAR-003', 'ANT-VANC', '8901234567892', 'GTIN-13', 'AstraMed Inc', 'Vancomycin HCl 500mg', '500mg', 'Injection', 'vial', 1, TRUE),
  ('BAR-004', 'ANT-COLI', '8901234567893', 'GTIN-13', 'Apex Health Supply', 'Colistin 1 Million IU', '1 MIU', 'Injection', 'vial', 1, TRUE),
  ('BAR-005', 'ANT-PIPT', '8901234567894', 'GTIN-13', 'BioGen Logistics', 'Piperacillin-Tazobactam 4.5g', '4.5g', 'Injection', 'vial', 1, TRUE),
  ('BAR-006', 'ANT-CIFT', '8901234567895', 'GTIN-13', 'PharmaCore Global', 'Ceftriaxone Sodium 1g', '1g', 'Injection', 'vial', 1, TRUE);

-- Seed Policies
DELETE FROM `patchamomma-2026-505909.amr_resilience.medicine_regulatory_policies` WHERE TRUE;
INSERT INTO `patchamomma-2026-505909.amr_resilience.medicine_regulatory_policies`
  (policy_id, antibiotic_id, policy_name, jurisdiction, restriction_level, aware_category_override, requires_prescription, requires_approval, requires_documentation, authorized_department_codes, authorized_roles, max_issue_quantity, max_issue_unit, audit_required, policy_effective_date, policy_source, notes, is_active)
VALUES
  ('POL-001', 'ANT-MERO', 'Meropenem Restricted Control', 'hospital_internal', 'restricted', 'Watch', TRUE, TRUE, TRUE, '["ICU","ED","SURG","PHARM"]', '["pharmacist","chief_pharmacist","attending_physician"]', 100.0, 'vials', TRUE, '2026-01-01', 'WHO-AWaRe-2023', 'Carbapenem. Approval required.', TRUE),
  ('POL-002', 'ANT-VANC', 'Vancomycin Restricted Control', 'hospital_internal', 'restricted', 'Watch', TRUE, FALSE, FALSE, NULL, '["pharmacist","chief_pharmacist","attending_physician","department_staff"]', 200.0, 'vials', TRUE, '2026-01-01', 'WHO-AWaRe-2023', 'Prescription required.', TRUE),
  ('POL-003', 'ANT-COLI', 'Colistin Reserve Control', 'hospital_internal', 'reserve', 'Reserve', TRUE, TRUE, TRUE, '["ICU","ED"]', '["chief_pharmacist","attending_physician"]', 20.0, 'vials', TRUE, '2026-01-01', 'WHO-AWaRe-2023', 'Reserve antibiotic. CMO approval required.', TRUE),
  ('POL-004', 'ANT-PIPT', 'Piperacillin-Tazobactam Control', 'hospital_internal', 'restricted', 'Watch', TRUE, FALSE, FALSE, NULL, NULL, 500.0, 'vials', TRUE, '2026-01-01', 'WHO-AWaRe-2023', 'Watch antibiotic.', TRUE),
  ('POL-005', 'ANT-CIFT', 'Ceftriaxone Standard Access', 'hospital_internal', 'unrestricted', 'Access', TRUE, FALSE, FALSE, NULL, NULL, 1000.0, 'vials', FALSE, '2026-01-01', 'WHO-AWaRe-2023', 'Access antibiotic.', TRUE);

-- Seed Department Allocations (only the seed rows; app-created allocations use other ids)
DELETE FROM `patchamomma-2026-505909.amr_resilience.department_allocations` WHERE allocation_id LIKE 'ALLOC-0%';
INSERT INTO `patchamomma-2026-505909.amr_resilience.department_allocations`
  (allocation_id, hospital_id, department_id, antibiotic_id, allocation_period_start, allocation_period_end, allocated_quantity, reserved_quantity, consumed_quantity, reorder_threshold, demand_forecast_30d, risk_level, allocation_status, unit, created_by)
VALUES
  ('ALLOC-001', 'H001', 'DEPT-ICU',   'ANT-MERO', '2026-09-01', '2026-09-30', 420, 50, 210, 100, 520, 'HIGH',    'active', 'vials', 'system'),
  ('ALLOC-002', 'H001', 'DEPT-ED',    'ANT-MERO', '2026-09-01', '2026-09-30', 250, 20, 80,  60,  300, 'MEDIUM',  'active', 'vials', 'system'),
  ('ALLOC-003', 'H001', 'DEPT-OPD',   'ANT-MERO', '2026-09-01', '2026-09-30', 180, 10, 60,  40,  180, 'LOW',     'active', 'vials', 'system'),
  ('ALLOC-004', 'H001', 'DEPT-PHARM', 'ANT-MERO', '2026-09-01', '2026-09-30', 390, 80, 120, 100, 400, 'HIGH',    'active', 'vials', 'system'),
  ('ALLOC-005', 'H001', 'DEPT-ICU',   'ANT-VANC', '2026-09-01', '2026-09-30', 800, 50, 300, 200, 900, 'LOW',     'active', 'vials', 'system'),
  ('ALLOC-006', 'H001', 'DEPT-ED',    'ANT-VANC', '2026-09-01', '2026-09-30', 400, 20, 100, 100, 400, 'LOW',     'active', 'vials', 'system'),
  ('ALLOC-007', 'H001', 'DEPT-OPD',   'ANT-VANC', '2026-09-01', '2026-09-30', 200, 10, 40,  50,  200, 'LOW',     'active', 'vials', 'system'),
  ('ALLOC-008', 'H001', 'DEPT-PHARM', 'ANT-VANC', '2026-09-01', '2026-09-30', 3810,100,600, 500, 3500,'LOW',     'active', 'vials', 'system'),
  ('ALLOC-009', 'H001', 'DEPT-ICU',   'ANT-COLI', '2026-09-01', '2026-09-30', 600, 50, 400, 150, 700, 'CRITICAL','active', 'vials', 'system'),
  ('ALLOC-010', 'H001', 'DEPT-ED',    'ANT-COLI', '2026-09-01', '2026-09-30', 200, 20, 80,  50,  250, 'HIGH',    'active', 'vials', 'system'),
  ('ALLOC-011', 'H001', 'DEPT-PHARM', 'ANT-COLI', '2026-09-01', '2026-09-30', 90,  10, 40,  30,  120, 'CRITICAL','active', 'vials', 'system');