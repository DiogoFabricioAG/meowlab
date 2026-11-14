-- Collections Cat (ADR-0015, fase 1): cuentas por cobrar de cada empresa.
-- Los pagos son la fuente de verdad; `receivables.debts.balance_cents` se actualiza en la
-- misma transacción que cada pago confirmado. Solo soles (ADR-0008).
BEGIN;

CREATE SCHEMA IF NOT EXISTS receivables;

-- Para escribirle al cliente (ADR-0015, consecuencias). Solo dígitos, con código de país.
ALTER TABLE commerce.customers ADD COLUMN IF NOT EXISTS phone TEXT
  CHECK (phone IS NULL OR phone ~ '^[0-9]{8,15}$');

CREATE TABLE IF NOT EXISTS receivables.settings (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'courtesy',
  active_until TIMESTAMPTZ,
  -- Desde cuándo se leen las facturas a crédito de FacturaYa.
  documents_since DATE NOT NULL DEFAULT CURRENT_DATE,
  default_due_days INTEGER NOT NULL DEFAULT 30 CHECK (default_due_days BETWEEN 0 AND 365),
  remind_before_days INTEGER NOT NULL DEFAULT 2 CHECK (remind_before_days BETWEEN 0 AND 30),
  remind_every_days INTEGER NOT NULL DEFAULT 7 CHECK (remind_every_days BETWEEN 1 AND 60),
  max_reminders INTEGER NOT NULL DEFAULT 3 CHECK (max_reminders BETWEEN 1 AND 20),
  window_start_hour INTEGER NOT NULL DEFAULT 9 CHECK (window_start_hour BETWEEN 0 AND 23),
  window_end_hour INTEGER NOT NULL DEFAULT 19 CHECK (window_end_hour BETWEEN 1 AND 24),
  skip_sundays BOOLEAN NOT NULL DEFAULT TRUE,
  -- Formas de pago que el gato ofrece (ADR-0015, punto 7).
  yape_phone TEXT CHECK (yape_phone IS NULL OR yape_phone ~ '^[0-9]{9}$'),
  plin_phone TEXT CHECK (plin_phone IS NULL OR plin_phone ~ '^[0-9]{9}$'),
  bank_text TEXT CHECK (bank_text IS NULL OR length(bank_text) <= 300),
  payment_link TEXT CHECK (payment_link IS NULL OR (length(payment_link) <= 500 AND payment_link ~ '^https://')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT receivables_settings_source_check
    CHECK (source IN ('courtesy', 'subscription') AND (source = 'subscription' OR active_until IS NULL)),
  CONSTRAINT receivables_settings_window_check CHECK (window_start_hour < window_end_hour)
);

CREATE TABLE IF NOT EXISTS receivables.debts (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES commerce.customers(id),
  -- sale: venta al crédito de Sales Cat; invoice: factura a crédito de FacturaYa; chat: dicha.
  source TEXT NOT NULL CHECK (source IN ('sale', 'invoice', 'chat')),
  -- «sale:<uuid>» o «invoice:<id de FacturaYa>»: cada origen crea una sola deuda.
  source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) <= 100),
  document_number TEXT CHECK (document_number IS NULL OR length(document_number) <= 40),
  description TEXT CHECK (description IS NULL OR length(description) <= 300),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  balance_cents BIGINT NOT NULL CHECK (balance_cents >= 0),
  issued_on DATE NOT NULL,
  due_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  reminders_sent INTEGER NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
  last_reminder_at TIMESTAMPTZ,
  -- Pasó a la titular (ADR-0015, punto 18).
  escalated_at TIMESTAMPTZ,
  created_by_contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (balance_cents <= amount_cents)
);
CREATE UNIQUE INDEX IF NOT EXISTS debts_tenant_source ON receivables.debts (tenant_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS debts_tenant_open ON receivables.debts (tenant_id, due_on) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS debts_customer ON receivables.debts (customer_id);

-- Clientes a los que no se les escribe (pidieron que no) y su nota.
CREATE TABLE IF NOT EXISTS receivables.customer_rules (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES commerce.customers(id) ON DELETE CASCADE,
  do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_contact_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, customer_id)
);

CREATE TABLE IF NOT EXISTS receivables.payments (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  debt_id UUID NOT NULL REFERENCES receivables.debts(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('yape', 'plin', 'transferencia', 'efectivo', 'tarjeta', 'enlace', 'nota_credito', 'otro')),
  operation_number TEXT CHECK (operation_number IS NULL OR length(operation_number) <= 60),
  paid_on DATE NOT NULL,
  -- pending: captura por validar; confirmed: aplicado al saldo; rejected: no se aplicó.
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  -- Una nota de crédito de FacturaYa se aplica una sola vez.
  source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) <= 100),
  reported_by_contact_id BIGINT,
  decided_by_contact_id BIGINT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_source ON receivables.payments (tenant_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_debt ON receivables.payments (debt_id);
CREATE INDEX IF NOT EXISTS payments_tenant_time ON receivables.payments (tenant_id, paid_on DESC) WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS receivables.reminders (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  debt_id UUID NOT NULL REFERENCES receivables.debts(id) ON DELETE CASCADE,
  -- prepared: el gato armó el mensaje y el equipo lo envía (fase 1); sent: lo envió el número de la empresa.
  channel TEXT NOT NULL CHECK (channel IN ('prepared', 'sent')),
  tone TEXT NOT NULL CHECK (tone IN ('friendly', 'firm', 'final')),
  contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS reminders_debt ON receivables.reminders (debt_id, created_at DESC);

-- Quién cambió qué (ADR-0015, punto 11).
CREATE TABLE IF NOT EXISTS receivables.audit_log (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  contact_id BIGINT,
  portal_user_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS audit_tenant_time ON receivables.audit_log (tenant_id, created_at DESC);

COMMIT;
