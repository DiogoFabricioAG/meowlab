-- Subidas temporales de bases PDF/DOCX recibidas por WhatsApp para Tender Cat y avisos idempotentes de preparación.
CREATE TABLE radar_bases_uploads (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES radar_installations(id),
  phone_number_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES radar_deliveries(id),
  ocid TEXT NOT NULL,
  code TEXT NOT NULL,
  meta_message_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (phone_number_id, recipient, meta_message_id)
);
CREATE INDEX radar_bases_uploads_pending ON radar_bases_uploads(installation_id, status, expires_at, created_at);

CREATE TABLE radar_preparation_notices (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES radar_installations(id),
  phone_number_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  ocid TEXT NOT NULL,
  job_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'accepted', 'unknown', 'rejected')),
  provider_message_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (installation_id, ocid, job_fingerprint)
);
