-- Cobros por suscripción (ADR-0007, fase 1). Catálogo y descuentos del informe
-- ejecutivo 2027-2029 (tarifas al 08/11/2026, IGV incluido). El servidor calcula el
-- importe; un pago del proveedor concede como máximo un periodo.
BEGIN;

CREATE TABLE IF NOT EXISTS billing_agents (
  key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name TEXT NOT NULL,
  role_key TEXT,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  available BOOLEAN NOT NULL DEFAULT false,
  sort INTEGER NOT NULL
);

INSERT INTO billing_agents (key, name, role_key, description, price_cents, available, sort) VALUES
  ('invoice', 'Invoice Cat', 'enterprise-advisor', 'Facturas, boletas, notas y guías de remisión por WhatsApp.', 3900, true, 1),
  ('sales', 'Sales Cat', NULL, 'Atiende consultas, registra pedidos y coordina datos de venta.', 5900, false, 2),
  ('stock', 'Stock Cat', NULL, 'Consulta y supervisa inventario y concilia diferencias.', 2900, false, 3),
  ('reorder', 'Reorder Cat', NULL, 'Detecta niveles mínimos y propone reposición.', 2500, false, 4),
  ('support', 'Support Cat', NULL, 'Resuelve consultas frecuentes y escala excepciones.', 3900, false, 5),
  ('collections', 'Collections Cat', NULL, 'Seguimiento de cuentas por cobrar y conciliación.', 2500, false, 6)
ON CONFLICT (key) DO NOTHING;

-- Descuento según la cantidad de agentes activos: se aplica el mayor min_agents <= n.
CREATE TABLE IF NOT EXISTS billing_discounts (
  min_agents INTEGER PRIMARY KEY CHECK (min_agents >= 1),
  percent INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 90)
);
INSERT INTO billing_discounts (min_agents, percent) VALUES (1, 0), (2, 10), (3, 15), (5, 20)
ON CONFLICT (min_agents) DO NOTHING;

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  agents TEXT[] NOT NULL CHECK (cardinality(agents) BETWEEN 1 AND 6),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'PEN' CHECK (currency = 'PEN'),
  status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'authorized', 'paused', 'cancelled', 'failed')),
  provider TEXT NOT NULL DEFAULT 'mercadopago' CHECK (provider = 'mercadopago'),
  external_reference TEXT NOT NULL UNIQUE,
  provider_ref TEXT UNIQUE,
  payer_email TEXT NOT NULL,
  checkout_url TEXT,
  paid_until TIMESTAMPTZ,
  next_payment_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Una suscripción viva por cuenta; las canceladas o fallidas quedan como historial.
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_one_live
  ON billing_subscriptions (user_id) WHERE status IN ('creating', 'pending', 'authorized', 'paused');

CREATE TABLE IF NOT EXISTS billing_payments (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES billing_subscriptions (id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('mercadopago', 'yape_manual')),
  -- Referencia del proveedor (authorized payment de Mercado Pago): nunca concede dos periodos.
  provider_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'PEN'),
  paid_at TIMESTAMPTZ NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL CHECK (period_end > period_start),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);
CREATE INDEX IF NOT EXISTS billing_payments_subscription_idx ON billing_payments (subscription_id, paid_at DESC);

-- Notificaciones recibidas (auditoría; sin cuerpo ni datos personales).
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  topic TEXT NOT NULL,
  resource_ref TEXT NOT NULL,
  request_id TEXT,
  outcome TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
