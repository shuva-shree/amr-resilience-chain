-- Migration 014: Vendor document management + admin approval workflow

CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.vendor_documents` (
  document_id         STRING NOT NULL,
  vendor_name         STRING,
  doc_type            STRING,            -- contract | invoice | agreement | purchase_order | other
  object_uri          STRING NOT NULL,
  original_filename   STRING,
  content_type        STRING,
  size_bytes          INT64,
  status              STRING NOT NULL,   -- pending | validated | approved | rejected
  invoice_amount      FLOAT64,
  currency            STRING,
  contract_expiration DATE,
  line_items          STRING,            -- JSON array
  extracted_metadata  STRING,            -- JSON object
  extraction_method   STRING,            -- heuristic | document_ai | none
  uploaded_by         STRING,
  uploaded_at         TIMESTAMP NOT NULL,
  reviewed_by         STRING,
  reviewed_at         TIMESTAMP,
  review_notes        STRING,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);

-- Immutable audit trail for every state transition on a vendor document.
CREATE TABLE IF NOT EXISTS `patchamomma-2026-505909.amr_resilience.vendor_document_events` (
  event_id         STRING NOT NULL,
  document_id      STRING NOT NULL,
  event_type       STRING NOT NULL,   -- uploaded | extracted | validated | approved | rejected | note
  actor_id         STRING,
  actor_role       STRING,
  from_status      STRING,
  to_status        STRING,
  notes            STRING,
  event_timestamp  TIMESTAMP NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
);
