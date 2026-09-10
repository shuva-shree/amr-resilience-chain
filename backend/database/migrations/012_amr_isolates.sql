-- Migration 012: Isolate-level AMR surveillance (synthetic + GLASS + hospital feeds)
-- One row per organism/antibiotic susceptibility test result.

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.amr_isolates` (
  isolate_id            STRING NOT NULL,
  data_source           STRING NOT NULL,   -- synthetic | glass | hospital
  batch_id              STRING,            -- ingestion batch / generation run
  hospital_id           STRING,
  region                STRING,            -- e.g. South-East Asia, Europe
  who_region            STRING,
  country               STRING,
  collection_date       DATE NOT NULL,
  specimen              STRING,            -- blood | urine | sputum | wound | csf | stool
  infection_type        STRING,           -- BSI | UTI | LRTI | SSTI | ...
  pathogen              STRING NOT NULL,
  pathogen_id           STRING,
  antibiotic            STRING NOT NULL,
  antibiotic_id         STRING,
  mic_value             FLOAT64,           -- mg/L
  mic_unit              STRING,
  interpretation        STRING NOT NULL,   -- R | I | S
  resistance_mechanism  STRING,            -- ESBL | CRE | MRSA | VRE | ... | none
  patient_age_group     STRING,            -- 0-4 | 5-17 | 18-64 | 65+
  patient_sex           STRING,            -- F | M | U
  patient_setting       STRING,            -- inpatient | outpatient | ICU
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- Monthly resistance aggregation used by the surveillance UI.
CREATE OR REPLACE VIEW `patchamomma-2026-505909.amr_resilience.v_amr_isolate_resistance_monthly` AS
SELECT
  DATE_TRUNC(collection_date, MONTH) AS month,
  region,
  pathogen,
  pathogen_id,
  antibiotic,
  antibiotic_id,
  specimen,
  data_source,
  COUNT(*) AS isolates_tested,
  COUNTIF(interpretation = 'R') AS resistant_count,
  COUNTIF(interpretation = 'I') AS intermediate_count,
  COUNTIF(interpretation = 'S') AS susceptible_count,
  ROUND(SAFE_DIVIDE(COUNTIF(interpretation = 'R'), COUNT(*)) * 100, 2) AS resistance_pct,
  ROUND(APPROX_QUANTILES(mic_value, 100)[OFFSET(50)], 3) AS mic50,
  ROUND(APPROX_QUANTILES(mic_value, 100)[OFFSET(90)], 3) AS mic90
FROM `patchamomma-2026-505909.amr_resilience.amr_isolates`
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;
