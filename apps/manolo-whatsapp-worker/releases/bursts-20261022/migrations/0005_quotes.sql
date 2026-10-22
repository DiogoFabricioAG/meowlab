CREATE TABLE IF NOT EXISTS quote_configs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  address TEXT NOT NULL,
  services_json TEXT NOT NULL DEFAULT '[]',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  bank_cci TEXT NOT NULL DEFAULT '',
  advisor_name TEXT NOT NULL DEFAULT '',
  advisor_phone TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'PEN',
  tax_rate REAL NOT NULL DEFAULT 0.18,
  prices_include_tax INTEGER NOT NULL DEFAULT 1 CHECK (prices_include_tax IN (0, 1)),
  valid_days INTEGER NOT NULL DEFAULT 7,
  logo_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quote_sequences (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 100 CHECK (next_number > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, contact_id)
);

CREATE TABLE IF NOT EXISTS quote_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'ready', 'confirmed', 'sent', 'cancelled')),
  quote_number TEXT,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_tax_id TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  expires_at TEXT,
  importe_letras TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_quote_drafts_contact_status
  ON quote_drafts (tenant_id, contact_id, status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_drafts_one_active
  ON quote_drafts (tenant_id, contact_id)
  WHERE status IN ('collecting', 'ready', 'confirmed');

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (draft_id, position)
);

CREATE INDEX IF NOT EXISTS idx_quote_items_draft
  ON quote_items (draft_id, position);

INSERT OR IGNORE INTO quote_configs (
  tenant_id,
  legal_name,
  tax_id,
  address,
  services_json,
  bank_name,
  bank_account,
  bank_cci,
  advisor_name,
  advisor_phone,
  currency,
  tax_rate,
  prices_include_tax,
  valid_days
)
VALUES (
  'manolo',
  'VENTA DE TELAS, TAPASOLES, TULES EXCLUSIVOS PARA CORTINAS',
  '10088195847',
  'Jr. Gamarra 653 2do Sotano Tda. 1 Galeria Plaza La Victoria',
  '["CONFECCIONAMOS CORTINAS, ESTORES, ONDAS DRAPEADAS Y ROLLERS","PERSIANAS VERTICALES, HORIZONTALES DE MADERA, PUERTA PLEGADIZA","TAPICERIA, FABRICACION DE MUEBLES DE MELAMINE","VIDRIOS TEMPLADOS PARA BAÑOS"]',
  'BCP',
  '19124261433097',
  '00219112426143309752',
  'Antonio Larrauri',
  '995446540',
  'PEN',
  0.18,
  1,
  7
);
