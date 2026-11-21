-- Alta de empresa sin RUC obligatorio (ADR-0019): rubro y ciudad opcionales en whatsapp.tenants.
-- ruc, legal_name y address ya admiten NULL y whatsapp_tenants_ruc_unique ya es índice parcial.
BEGIN;

ALTER TABLE whatsapp.tenants
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT;

COMMIT;
