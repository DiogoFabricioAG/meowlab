-- Stock Cat (ADR-0014, fase 1): inventario por empresa en el chat de Manolo.
-- Los movimientos son la fuente de verdad; `stock.items.on_hand` y `avg_cost_cents` se
-- actualizan en la misma transacción que cada movimiento. Un solo almacén y solo unidades.
BEGIN;

CREATE SCHEMA IF NOT EXISTS stock;

CREATE TABLE IF NOT EXISTS stock.settings (
  tenant_id TEXT PRIMARY KEY REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Igual que Sales Cat: cortesía (a mano) o suscripción con fin de periodo (ADR-0007).
  source TEXT NOT NULL DEFAULT 'courtesy',
  active_until TIMESTAMPTZ,
  -- La titular decide si un producto puede quedar en negativo (ADR-0014, punto 17).
  allow_negative BOOLEAN NOT NULL DEFAULT TRUE,
  -- Desde cuándo se leen los comprobantes de FacturaYa: lo emitido antes no mueve stock.
  documents_since DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stock_settings_source_check
    CHECK (source IN ('courtesy', 'subscription') AND (source = 'subscription' OR active_until IS NULL))
);

CREATE TABLE IF NOT EXISTS stock.items (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  -- product: lo que se vende (mismo nombre que el catálogo de Sales Cat); supply: insumo.
  kind TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product', 'supply')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  on_hand NUMERIC(14, 3) NOT NULL DEFAULT 0,
  min_qty NUMERIC(14, 3) CHECK (min_qty IS NULL OR min_qty >= 0),
  avg_cost_cents NUMERIC(16, 4) CHECK (avg_cost_cents IS NULL OR avg_cost_cents >= 0),
  -- Ya se avisó que bajó del mínimo; vuelve a FALSE cuando sube otra vez.
  below_min_alerted BOOLEAN NOT NULL DEFAULT FALSE,
  -- Se contó y quedó en negativo con la regla «no permitir»: pide un conteo.
  needs_count BOOLEAN NOT NULL DEFAULT FALSE,
  last_out_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS items_tenant_name ON stock.items (tenant_id, lower(name));

-- Otros nombres con que aparece un ítem en los comprobantes («POLO BLANCO TALLA M»).
CREATE TABLE IF NOT EXISTS stock.aliases (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 300),
  item_id UUID NOT NULL REFERENCES stock.items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, alias)
);

CREATE TABLE IF NOT EXISTS stock.moves (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES stock.items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out', 'adjust', 'count', 'document_out', 'document_in')),
  -- Cambio con signo: +entrada, -salida.
  delta NUMERIC(14, 3) NOT NULL,
  balance_after NUMERIC(14, 3) NOT NULL,
  unit_cost_cents NUMERIC(16, 4) CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  document_number TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS moves_tenant_time ON stock.moves (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS moves_item_time ON stock.moves (item_id, created_at DESC);

-- Comprobantes de FacturaYa ya procesados: cada uno mueve stock una sola vez.
CREATE TABLE IF NOT EXISTS stock.documents (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL CHECK (length(document_id) BETWEEN 1 AND 64),
  number TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  -- Líneas que no se pudieron asociar a un ítem: [{description, quantity}].
  unmatched JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unmatched) = 'array'),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, document_id)
);

COMMIT;
