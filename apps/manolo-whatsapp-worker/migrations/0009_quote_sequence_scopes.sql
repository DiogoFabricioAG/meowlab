CREATE TABLE quote_sequence_scopes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 100 CHECK (next_number > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quote_sequence_scopes_tenant
  ON quote_sequence_scopes (tenant_id, name);

CREATE TABLE quote_sequence_members (
  scope_id TEXT NOT NULL REFERENCES quote_sequence_scopes(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, contact_id),
  UNIQUE (scope_id, contact_id)
);

CREATE INDEX idx_quote_sequence_members_scope
  ON quote_sequence_members (scope_id);

ALTER TABLE quote_drafts ADD COLUMN sequence_scope_id TEXT REFERENCES quote_sequence_scopes(id);

INSERT INTO quote_sequence_scopes (
  id, tenant_id, name, next_number
)
SELECT
  tenant_id || ':contact:' || contact_id,
  tenant_id,
  'Contacto ' || contact_id,
  next_number
FROM quote_sequences;

INSERT OR IGNORE INTO quote_sequence_scopes (
  id, tenant_id, name, next_number
)
SELECT DISTINCT
  qd.tenant_id || ':contact:' || qd.contact_id,
  qd.tenant_id,
  'Contacto ' || qd.contact_id,
  100
FROM quote_drafts qd
WHERE NOT EXISTS (
  SELECT 1
  FROM quote_sequence_scopes qs
  WHERE qs.id = qd.tenant_id || ':contact:' || qd.contact_id
);

INSERT INTO quote_sequence_members (scope_id, tenant_id, contact_id)
SELECT
  tenant_id || ':contact:' || contact_id,
  tenant_id,
  contact_id
FROM quote_sequences;

INSERT OR IGNORE INTO quote_sequence_members (scope_id, tenant_id, contact_id)
SELECT DISTINCT
  qd.tenant_id || ':contact:' || qd.contact_id,
  qd.tenant_id,
  qd.contact_id
FROM quote_drafts qd;

UPDATE quote_drafts
SET sequence_scope_id = tenant_id || ':contact:' || contact_id
WHERE sequence_scope_id IS NULL;

DROP TABLE quote_sequences;
