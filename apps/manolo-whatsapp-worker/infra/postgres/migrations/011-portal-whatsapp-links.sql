-- Portal app.meowlab.tech (ADR-0006): vínculo cuenta ↔ número de WhatsApp verificado
-- con un código de un solo uso. Sólo se guarda el hash HMAC del código.
BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp.portal_link_challenges (
  id UUID PRIMARY KEY,
  portal_user_id TEXT NOT NULL CHECK (length(portal_user_id) BETWEEN 1 AND 128),
  wa_phone TEXT NOT NULL CHECK (wa_phone ~ '^[1-9][0-9]{7,14}$'),
  code_hash TEXT NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  delivery TEXT NOT NULL CHECK (delivery IN ('pending', 'sent', 'failed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS portal_link_challenges_phone_idx
  ON whatsapp.portal_link_challenges (wa_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_link_challenges_user_idx
  ON whatsapp.portal_link_challenges (portal_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp.portal_whatsapp_links (
  portal_user_id TEXT PRIMARY KEY CHECK (length(portal_user_id) BETWEEN 1 AND 128),
  wa_phone TEXT NOT NULL UNIQUE CHECK (wa_phone ~ '^[1-9][0-9]{7,14}$'),
  linked_at TIMESTAMPTZ NOT NULL
);

COMMIT;
