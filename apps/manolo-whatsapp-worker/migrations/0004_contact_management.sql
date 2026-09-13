ALTER TABLE contacts
  ADD COLUMN display_name TEXT;

ALTER TABLE contacts
  ADD COLUMN active_role_key TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_active_role
  ON contacts (tenant_id, active_role_key);
