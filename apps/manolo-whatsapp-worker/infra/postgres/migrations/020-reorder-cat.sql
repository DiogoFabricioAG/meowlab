-- Reorder Cat (ADR-0016, fase 1): reposición de lo que se acaba en Stock Cat.
-- El gato propone; la titular aprueba; el pedido sale al proveedor desde el número de MeowLab
-- o se convierte en una orden de producción. La recepción llega por las entradas de Stock Cat.
BEGIN;

CREATE SCHEMA IF NOT EXISTS purchasing;

CREATE TABLE IF NOT EXISTS purchasing.settings (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Igual que los demás gatos: cortesía (a mano) o suscripción con fin de periodo (ADR-0007).
  source TEXT NOT NULL DEFAULT 'courtesy',
  active_until TIMESTAMPTZ,
  -- Presupuesto mensual de compras (punto 15); NULL es sin tope.
  monthly_budget_cents BIGINT CHECK (monthly_budget_cents IS NULL OR monthly_budget_cents > 0),
  -- Insistencia y escalado cuando el proveedor no responde (puntos 10 y 21).
  followup_hours INTEGER NOT NULL DEFAULT 24 CHECK (followup_hours BETWEEN 1 AND 168),
  escalate_hours INTEGER NOT NULL DEFAULT 48 CHECK (escalate_hours BETWEEN 2 AND 336),
  last_order_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT purchasing_settings_source_check
    CHECK (source IN ('courtesy', 'subscription') AND (source = 'subscription' OR active_until IS NULL)),
  CONSTRAINT purchasing_settings_escalate_check CHECK (escalate_hours > followup_hours)
);

CREATE TABLE IF NOT EXISTS purchasing.suppliers (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  ruc TEXT CHECK (ruc IS NULL OR ruc ~ '^[0-9]{11}$'),
  -- WhatsApp en formato internacional sin «+» (51987654321).
  phone TEXT CHECK (phone IS NULL OR phone ~ '^[0-9]{8,15}$'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_name ON purchasing.suppliers (tenant_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_ruc ON purchasing.suppliers (tenant_id, ruc) WHERE ruc IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_phone ON purchasing.suppliers (phone) WHERE phone IS NOT NULL;

-- Cómo se repone cada ítem de Stock Cat (puntos 2, 4 y 5).
CREATE TABLE IF NOT EXISTS purchasing.item_rules (
  item_id UUID PRIMARY KEY REFERENCES stock.items(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  supply_type TEXT NOT NULL DEFAULT 'purchase' CHECK (supply_type IN ('purchase', 'manufacture')),
  max_qty NUMERIC(14, 3) CHECK (max_qty IS NULL OR max_qty > 0),
  supplier_id UUID REFERENCES purchasing.suppliers(id) ON DELETE SET NULL,
  -- Último precio unitario conocido de ese proveedor (respuesta o factura), IGV incluido.
  last_unit_cost_cents BIGINT CHECK (last_unit_cost_cents IS NULL OR last_unit_cost_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS item_rules_tenant ON purchasing.item_rules (tenant_id);

-- Un pedido a un proveedor (purchase) o una orden de producción (production).
CREATE TABLE IF NOT EXISTS purchasing.orders (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'production')),
  supplier_id UUID REFERENCES purchasing.suppliers(id) ON DELETE RESTRICT,
  -- proposed → sent → confirmed → partial → received (compra); proposed → in_production → done
  -- (producción). declined y cancelled cierran; escalated_at marca lo que pasó a la titular.
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'sent', 'confirmed', 'partial', 'received', 'declined', 'in_production', 'done', 'cancelled')),
  estimated_cents BIGINT CHECK (estimated_cents IS NULL OR estimated_cents >= 0),
  confirmed_cents BIGINT CHECK (confirmed_cents IS NULL OR confirmed_cents >= 0),
  deliver_by DATE,
  supplier_note TEXT CHECK (supplier_note IS NULL OR length(supplier_note) <= 500),
  approved_by_contact_id BIGINT,
  approved_at TIMESTAMPTZ,
  -- Por dónde salió el pedido: el número de MeowLab que lo envió, para insistir desde el mismo.
  channel_tenant_id TEXT,
  phone_number_id TEXT,
  sent_at TIMESTAMPTZ,
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  pdf_sent_to_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  escalated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT orders_supplier_check CHECK ((kind = 'purchase') = (supplier_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_number ON purchasing.orders (tenant_id, number);
CREATE INDEX IF NOT EXISTS orders_tenant_status ON purchasing.orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS orders_waiting ON purchasing.orders (sent_at) WHERE status = 'sent' AND replied_at IS NULL;

CREATE TABLE IF NOT EXISTS purchasing.order_lines (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES purchasing.orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES stock.items(id) ON DELETE RESTRICT,
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  received_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_price_cents BIGINT CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  position INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS order_lines_order ON purchasing.order_lines (order_id, position);
CREATE INDEX IF NOT EXISTS order_lines_item ON purchasing.order_lines (item_id);

-- Lo que la titular tiene que saber (respuesta del proveedor, escalado, recepción). Se intenta
-- enviar en el momento; si no se pudo, aparece al abrir /reorder y en el portal.
CREATE TABLE IF NOT EXISTS purchasing.notices (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  order_id UUID REFERENCES purchasing.orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('supplier_reply', 'declined', 'escalated', 'received')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1500),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS notices_pending ON purchasing.notices (tenant_id, created_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS purchasing.audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  contact_id BIGINT,
  portal_user_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS purchasing_audit_tenant_time ON purchasing.audit_log (tenant_id, created_at DESC);

COMMIT;
