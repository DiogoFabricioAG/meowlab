-- Support Cat (ADR-0017, fase 1): postventa 24/7 en el número de WhatsApp de la empresa.
-- Responde con las preguntas frecuentes y el estado en Sales Cat; lo que no sabe pasa a la
-- titular como ticket. El cliente es el mismo de commerce.customers (por teléfono).
BEGIN;

CREATE SCHEMA IF NOT EXISTS support;

CREATE TABLE IF NOT EXISTS support.settings (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Igual que los demás gatos: cortesía (a mano) o suscripción con fin de periodo (ADR-0007).
  source TEXT NOT NULL DEFAULT 'courtesy',
  active_until TIMESTAMPTZ,
  -- El número de WhatsApp de la empresa (phone_number_id de Meta o Kapso): un número, una empresa.
  phone_number_id TEXT CHECK (phone_number_id IS NULL OR phone_number_id ~ '^[0-9]{5,32}$'),
  -- Resumen diario a la titular (punto 15), hora de Lima.
  summary_hour INTEGER NOT NULL DEFAULT 20 CHECK (summary_hour BETWEEN 0 AND 23),
  last_summary_on DATE,
  last_ticket_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT support_settings_source_check
    CHECK (source IN ('courtesy', 'subscription') AND (source = 'subscription' OR active_until IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS support_settings_phone ON support.settings (phone_number_id) WHERE phone_number_id IS NOT NULL;

-- Preguntas frecuentes que carga la titular en el portal (punto 5).
CREATE TABLE IF NOT EXISTS support.faqs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  answer TEXT NOT NULL CHECK (length(answer) BETWEEN 1 AND 1500),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS faqs_tenant ON support.faqs (tenant_id, position);

-- Lo que pasa a la titular (puntos 6, 9, 16 y 17).
CREATE TABLE IF NOT EXISTS support.tickets (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  customer_id UUID REFERENCES commerce.customers(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL CHECK (customer_phone ~ '^[0-9]{8,15}$'),
  customer_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'complaint', 'human', 'sale', 'unhappy')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 1500),
  answer TEXT CHECK (answer IS NULL OR length(answer) <= 1500),
  -- La respuesta de la titular llegó al cliente (su ventana de 24 horas estaba abierta).
  relayed BOOLEAN NOT NULL DEFAULT FALSE,
  answered_by_contact_id BIGINT,
  answered_at TIMESTAMPTZ,
  -- El aviso a la titular salió por WhatsApp; si no, espera en /support y el portal.
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_tenant_number ON support.tickets (tenant_id, number);
CREATE INDEX IF NOT EXISTS tickets_open ON support.tickets (tenant_id, created_at) WHERE status = 'open';

-- Cada mensaje atendido, para el resumen diario y la satisfacción (puntos 15 y 16).
CREATE TABLE IF NOT EXISTS support.events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('answered', 'quoted', 'escalated', 'rated_yes', 'rated_no')),
  -- Idempotencia: el id del mensaje de WhatsApp que lo originó.
  source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS events_source ON support.events (tenant_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_tenant_time ON support.events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support.audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  contact_id BIGINT,
  portal_user_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS support_audit_tenant_time ON support.audit_log (tenant_id, created_at DESC);

COMMIT;
