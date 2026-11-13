-- Sales Cat (ADR-0011, fase 1) sobre los módulos del ADR-0008:
--   commerce: clientes y productos de cada empresa;
--   sales: cotizaciones, ventas, numeración y auditoría.
-- La empresa es whatsapp.tenants(id). Importes en céntimos de sol (PEN).
BEGIN;

CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS sales;

-- Sales Cat se activa por empresa (piloto: CREACIONES J&D).
CREATE TABLE IF NOT EXISTS sales.settings (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quote_valid_days INTEGER NOT NULL DEFAULT 7 CHECK (quote_valid_days BETWEEN 1 AND 90),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commerce.customers (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('0', '1', '6')),
  doc_number TEXT CHECK (
    (doc_type = '0' AND doc_number IS NULL)
    OR (doc_type = '1' AND doc_number ~ '^[0-9]{8}$')
    OR (doc_type = '6' AND doc_number ~ '^[0-9]{11}$')
  ),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_by_contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_doc
  ON commerce.customers (tenant_id, doc_type, doc_number) WHERE doc_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_named
  ON commerce.customers (tenant_id, lower(name)) WHERE doc_number IS NULL;

CREATE TABLE IF NOT EXISTS commerce.products (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_name
  ON commerce.products (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS sales.sequences (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('quote', 'sale')),
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (tenant_id, kind)
);

CREATE TABLE IF NOT EXISTS sales.quotes (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  customer_id UUID REFERENCES commerce.customers(id),
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'cancelled')),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  valid_until DATE NOT NULL,
  -- Sólo el hash SHA-256 del código del enlace público.
  public_token_hash TEXT NOT NULL UNIQUE CHECK (public_token_hash ~ '^[0-9a-f]{64}$'),
  created_by_contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, number)
);

CREATE TABLE IF NOT EXISTS sales.sales (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  customer_id UUID REFERENCES commerce.customers(id),
  customer_name TEXT,
  quote_id UUID REFERENCES sales.quotes(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('efectivo', 'yape', 'plin', 'transferencia', 'tarjeta', 'credito')),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  -- Ventas al crédito: la deuda queda registrada (Collections Cat la cobrará).
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  sold_at TIMESTAMPTZ NOT NULL,
  seller_contact_id BIGINT,
  invoice_number TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, number)
);
CREATE INDEX IF NOT EXISTS sales_tenant_sold_at ON sales.sales (tenant_id, sold_at DESC);

CREATE TABLE IF NOT EXISTS sales.lines (
  id UUID PRIMARY KEY,
  quote_id UUID REFERENCES sales.quotes(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES sales.sales(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  product_id UUID REFERENCES commerce.products(id),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents >= 0),
  CHECK ((quote_id IS NULL) <> (sale_id IS NULL))
);
CREATE INDEX IF NOT EXISTS lines_quote ON sales.lines (quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lines_sale ON sales.lines (sale_id) WHERE sale_id IS NOT NULL;

-- Quién cambió qué (ADR-0011, punto 19).
CREATE TABLE IF NOT EXISTS sales.audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('sale', 'quote', 'product', 'customer')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'cancelled', 'invoiced')),
  contact_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS audit_entity ON sales.audit_log (tenant_id, entity, entity_id);

COMMIT;
