-- Migration 003: Medicine Barcodes
-- Maps barcodes/GTINs to antibiotic catalog entries

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.medicine_barcodes` (
  barcode_id        STRING    NOT NULL,
  antibiotic_id     STRING    NOT NULL,   -- FK -> antibiotics.antibiotic_id
  barcode_value     STRING    NOT NULL,   -- GS1 GTIN or internal hospital code
  barcode_type      STRING,               -- GTIN-13 | GTIN-14 | internal | GS1-128 | DataMatrix
  manufacturer_name STRING,
  product_name      STRING,
  strength          STRING,               -- e.g. "1g", "500mg"
  dosage_form       STRING,               -- Injection | Tablet | Capsule | Infusion
  packaging_unit    STRING,               -- vial | tablet | blister | box
  packaging_count   INT64,                -- units per package
  is_active         BOOL      DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
