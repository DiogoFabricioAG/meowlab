ALTER TABLE quote_sequences RENAME TO quote_sequences_tenant;

CREATE TABLE quote_sequences (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 100 CHECK (next_number > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, contact_id)
);

INSERT INTO quote_sequences (tenant_id, contact_id, next_number)
SELECT
  tenant_id,
  contact_id,
  MAX(CAST(quote_number AS INTEGER)) + 1
FROM quote_drafts
WHERE quote_number IS NOT NULL
GROUP BY tenant_id, contact_id;

DROP TABLE quote_sequences_tenant;
