-- Migration 013: Ingestion tracking (GLASS monthly job + hospital feeds)

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.glass_ingestion_runs` (
  run_id             STRING NOT NULL,
  run_type           STRING NOT NULL,   -- scheduled | manual | scrape
  status             STRING NOT NULL,   -- running | success | failed | partial
  started_at         TIMESTAMP NOT NULL,
  finished_at        TIMESTAMP,
  source_url         STRING,
  query_params       STRING,            -- JSON: {region, infection_type, pathogen, antibiotic}
  raw_object_uris    STRING,            -- JSON array of gs:// / file:// URIs
  files_downloaded   INT64 DEFAULT 0,
  rows_ingested      INT64 DEFAULT 0,
  rows_deduplicated  INT64 DEFAULT 0,
  dataset_version    STRING,
  error              STRING,
  triggered_by       STRING,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.hospital_ingestion_batches` (
  batch_id           STRING NOT NULL,
  source             STRING NOT NULL,   -- rest_api | fhir | sftp_drop | bucket_drop
  hospital_id        STRING,
  received_at        TIMESTAMP NOT NULL,
  object_uri         STRING,
  record_count       INT64 DEFAULT 0,
  accepted_count     INT64 DEFAULT 0,
  rejected_count     INT64 DEFAULT 0,
  pii_fields_removed STRING,            -- JSON array
  status             STRING NOT NULL,   -- received | processing | loaded | failed | partial
  error              STRING,
  submitted_by       STRING,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
