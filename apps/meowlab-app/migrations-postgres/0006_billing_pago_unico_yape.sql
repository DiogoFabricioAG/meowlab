-- Pago único por adelantado (1, 3 o 6 meses) vía Mercado Pago Checkout Pro (acepta Yape).
-- Sin aplicar automáticamente; revisar en despliegue.
BEGIN;

CREATE TABLE IF NOT EXISTS billing_orders (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  agents TEXT[] NOT NULL CHECK (cardinality(agents) BETWEEN 1 AND 7),
  months INTEGER NOT NULL CHECK (months IN (1, 3, 6)),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'PEN' CHECK (currency = 'PEN'),
  status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'approved', 'rejected', 'failed')),
  external_reference TEXT NOT NULL UNIQUE,
  preference_id TEXT UNIQUE,
  checkout_url TEXT,
  provider_payment_id TEXT UNIQUE,
  paid_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  entitlement_applied_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_orders_tenant_idx ON billing_orders (tenant_id, created_at DESC);

COMMIT;
