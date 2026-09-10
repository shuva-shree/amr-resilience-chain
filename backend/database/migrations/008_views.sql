CREATE OR REPLACE VIEW `patchamomma-2026-505909.amr_resilience.v_department_stock_coverage` AS
SELECT
  a.allocation_id,
  a.hospital_id,
  a.department_id,
  d.department_name,
  d.department_code,
  a.antibiotic_id,
  ab.antibiotic_name,
  ab.aware_category,
  a.allocated_quantity,
  a.reserved_quantity,
  a.consumed_quantity,
  (a.allocated_quantity - a.consumed_quantity - a.reserved_quantity) AS available_quantity,
  a.demand_forecast_30d,
  ROUND(
    SAFE_DIVIDE(
      (a.allocated_quantity - a.consumed_quantity - a.reserved_quantity),
      SAFE_DIVIDE(a.demand_forecast_30d, 30.0)
    ), 1
  ) AS calculated_coverage_days,
  a.risk_level,
  a.allocation_status
FROM `patchamomma-2026-505909.amr_resilience.department_allocations` a
LEFT JOIN `patchamomma-2026-505909.amr_resilience.departments` d ON a.department_id = d.department_id
LEFT JOIN `patchamomma-2026-505909.amr_resilience.antibiotics` ab ON a.antibiotic_id = ab.antibiotic_id;
