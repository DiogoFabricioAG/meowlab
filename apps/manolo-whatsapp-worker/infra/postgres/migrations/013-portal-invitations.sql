-- Portal app.meowlab.tech (ADR-0010, fase 2): invitaciones del dueño. Sólo se guarda el
-- hash SHA-256 del código del enlace; el código viaja una sola vez al dueño.
BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp.portal_company_invitations (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 128),
  -- Opcional: sólo una cuenta con este WhatsApp vinculado puede aceptarla.
  wa_phone TEXT CHECK (wa_phone ~ '^[1-9][0-9]{7,14}$'),
  access TEXT NOT NULL CHECK (access IN ('view', 'full')),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by TEXT CHECK (accepted_by IS NULL OR length(accepted_by) BETWEEN 1 AND 128),
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS portal_company_invitations_tenant_idx
  ON whatsapp.portal_company_invitations (tenant_id, created_at DESC);

COMMIT;
