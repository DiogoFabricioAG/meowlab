BEGIN;

-- Runtime state for the VPS platform. D1 remains the compatibility source
-- until the Worker is switched to these tables through the signed platform API.
CREATE TABLE IF NOT EXISTS whatsapp.conversation_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES whatsapp.contacts(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'expired', 'closed')),
  state_json TEXT NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp.idempotency_keys (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  response_json TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, scope, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_idx_conversation_sessions_active_contact
  ON whatsapp.conversation_sessions (tenant_id, contact_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS whatsapp_idx_conversation_sessions_expiration
  ON whatsapp.conversation_sessions (status, expires_at);
CREATE INDEX IF NOT EXISTS whatsapp_idx_idempotency_keys_expiration
  ON whatsapp.idempotency_keys (expires_at);

COMMIT;
