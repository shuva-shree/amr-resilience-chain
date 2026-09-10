-- Migration 010: Backfill antibiotics referenced by seed data (009)
-- The base dataset only shipped ANT-MERO. The demo seed references four more.
-- Only ANT-MERO has real inventory / prediction / trend history behind it.

INSERT INTO `patchamomma-2026-505909.amr_resilience.antibiotics`
  (antibiotic_id, antibiotic_name, atc_code, drug_class, aware_category, defined_daily_dose_g, route_of_admin, created_at)
SELECT * FROM UNNEST([
  STRUCT('ANT-VANC' AS antibiotic_id, 'Vancomycin' AS antibiotic_name, 'J01XA01' AS atc_code, 'Glycopeptides' AS drug_class, 'WATCH' AS aware_category, 2.0 AS defined_daily_dose_g, 'PARENTERAL' AS route_of_admin, CURRENT_TIMESTAMP() AS created_at),
  STRUCT('ANT-COLI', 'Colistin', 'J01XB01', 'Polymyxins', 'RESERVE', 0.009, 'PARENTERAL', CURRENT_TIMESTAMP()),
  STRUCT('ANT-PIPT', 'Piperacillin-Tazobactam', 'J01CR05', 'Beta-lactam/BLI combinations', 'WATCH', 14.0, 'PARENTERAL', CURRENT_TIMESTAMP()),
  STRUCT('ANT-CIFT', 'Ceftriaxone', 'J01DD04', 'Cephalosporins (3rd gen)', 'WATCH', 2.0, 'PARENTERAL', CURRENT_TIMESTAMP())
])
WHERE antibiotic_id NOT IN (
  SELECT antibiotic_id FROM `patchamomma-2026-505909.amr_resilience.antibiotics`
);
