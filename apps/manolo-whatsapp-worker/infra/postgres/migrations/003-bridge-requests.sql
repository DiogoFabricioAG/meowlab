BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp.bridge_requests (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  response_text TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bridge_requests_tenant_created
  ON whatsapp.bridge_requests (tenant_id, created_at DESC);

COMMIT;
