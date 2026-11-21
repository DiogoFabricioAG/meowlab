-- Tender Cat (ADR-0007 / T10): derecho de uso por empresa (`radar.settings`), con la
-- misma regla que los demás gatos: cortesía (sin vencimiento) o suscripción pagada con
-- `active_until` monótono. No cambia `Plan` (available sigue en false hasta definir precio).
BEGIN;

CREATE SCHEMA IF NOT EXISTS radar;

CREATE TABLE IF NOT EXISTS radar.settings (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'courtesy',
  active_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT radar_settings_source_check
    CHECK (source IN ('courtesy', 'subscription') AND (source = 'subscription' OR active_until IS NULL))
);

-- Conserva como cortesía activa a las empresas piloto que ya tenían el rol `radar`.
INSERT INTO radar.settings (tenant_id, enabled, source, active_until)
SELECT DISTINCT member.tenant_id, TRUE, 'courtesy', NULL
  FROM whatsapp.tenant_members AS member
  JOIN whatsapp.contacts AS contact ON contact.id = member.contact_id
 WHERE member.status = 'active' AND contact.active_role_key = 'radar'
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
