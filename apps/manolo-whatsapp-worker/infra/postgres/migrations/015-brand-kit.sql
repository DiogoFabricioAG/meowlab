-- Kit de marca por empresa (ADR-0012, fase 1): datos que van en todos sus documentos y su
-- logo. Lo edita quien administra la empresa desde el portal. El logo se guarda aquí mismo
-- (pequeño, ya reducido en el navegador) para que viaje con los respaldos de la base.
BEGIN;

CREATE SCHEMA IF NOT EXISTS commerce;

CREATE TABLE IF NOT EXISTS commerce.brand_kits (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  primary_color TEXT CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-f]{6}$'),
  contact_address TEXT CHECK (contact_address IS NULL OR length(contact_address) <= 200),
  contact_phone TEXT CHECK (contact_phone IS NULL OR length(contact_phone) <= 40),
  contact_email TEXT CHECK (contact_email IS NULL OR length(contact_email) <= 120),
  contact_web TEXT CHECK (contact_web IS NULL OR length(contact_web) <= 120),
  -- [{ "kind": "bank" | "cci" | "yape" | "plin", "label": "...", "value": "..." }], hasta 6.
  payment_methods JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(payment_methods) = 'array'),
  footer_text TEXT CHECK (footer_text IS NULL OR length(footer_text) <= 300),
  quote_valid_days INTEGER CHECK (quote_valid_days IS NULL OR quote_valid_days BETWEEN 1 AND 90),
  quote_payment_terms TEXT CHECK (quote_payment_terms IS NULL OR length(quote_payment_terms) <= 300),
  quote_delivery_terms TEXT CHECK (quote_delivery_terms IS NULL OR length(quote_delivery_terms) <= 300),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commerce.brand_logos (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 100 AND 307200),
  width INTEGER NOT NULL CHECK (width BETWEEN 16 AND 1200),
  height INTEGER NOT NULL CHECK (height BETWEEN 16 AND 1200),
  -- Versión para el caché del navegador: el SHA-256 del contenido.
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Las condiciones del kit se copian a cada cotización al crearla: cambiar el kit no reescribe
-- lo que ya se le envió a un cliente.
ALTER TABLE sales.quotes ADD COLUMN IF NOT EXISTS payment_terms TEXT CHECK (payment_terms IS NULL OR length(payment_terms) <= 300);
ALTER TABLE sales.quotes ADD COLUMN IF NOT EXISTS delivery_terms TEXT CHECK (delivery_terms IS NULL OR length(delivery_terms) <= 300);

COMMIT;
