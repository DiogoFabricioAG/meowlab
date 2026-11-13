-- Portal app.meowlab.tech (ADR-0010, fase 1): empresas creadas desde el portal y
-- membresías por cuenta del portal (dueño o miembro). Las membresías de los agentes
-- siguen en tenant_members, por número de WhatsApp.
BEGIN;

ALTER TABLE whatsapp.tenants
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'operator';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_origin_check' AND conrelid = 'whatsapp.tenants'::regclass
  ) THEN
    ALTER TABLE whatsapp.tenants
      ADD CONSTRAINT tenants_origin_check CHECK (origin IN ('operator', 'portal'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS whatsapp.portal_company_members (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  portal_user_id TEXT NOT NULL CHECK (length(portal_user_id) BETWEEN 1 AND 128),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, portal_user_id)
);

-- Una sola persona dueña por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS portal_company_members_one_owner
  ON whatsapp.portal_company_members (tenant_id)
  WHERE role = 'owner';

CREATE INDEX IF NOT EXISTS portal_company_members_user_idx
  ON whatsapp.portal_company_members (portal_user_id);

COMMIT;
