CREATE TABLE IF NOT EXISTS contact_role_states (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, contact_id, role_key)
);

CREATE INDEX IF NOT EXISTS idx_contact_role_states_contact
  ON contact_role_states (tenant_id, contact_id);
