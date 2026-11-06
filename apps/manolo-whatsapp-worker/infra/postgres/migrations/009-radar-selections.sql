BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_numbers_tenant_phone_unique
  ON whatsapp.whatsapp_numbers(tenant_id, phone_number_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contacts_tenant_id_unique
  ON whatsapp.contacts(tenant_id, id);

CREATE TABLE IF NOT EXISTS whatsapp.radar_sync_installations (
  installation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  contact_id BIGINT NOT NULL REFERENCES whatsapp.contacts(id) ON DELETE CASCADE,
  whatsapp_user_id TEXT NOT NULL,
  delivered_cursor BIGINT NOT NULL DEFAULT 0 CHECK (delivered_cursor >= 0),
  acked_cursor BIGINT NOT NULL DEFAULT 0 CHECK (acked_cursor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (installation_id, tenant_id, phone_number_id, contact_id),
  FOREIGN KEY (tenant_id, contact_id)
    REFERENCES whatsapp.contacts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, phone_number_id)
    REFERENCES whatsapp.whatsapp_numbers(tenant_id, phone_number_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whatsapp.radar_candidate_snapshots (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  contact_id BIGINT NOT NULL REFERENCES whatsapp.contacts(id) ON DELETE CASCADE,
  ocid TEXT NOT NULL,
  candidate JSONB NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, phone_number_id, contact_id, ocid),
  FOREIGN KEY (tenant_id, phone_number_id)
    REFERENCES whatsapp.whatsapp_numbers(tenant_id, phone_number_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, contact_id)
    REFERENCES whatsapp.contacts(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whatsapp.radar_selection_counters (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  contact_id BIGINT NOT NULL REFERENCES whatsapp.contacts(id) ON DELETE CASCADE,
  last_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (tenant_id, phone_number_id, contact_id),
  FOREIGN KEY (tenant_id, phone_number_id)
    REFERENCES whatsapp.whatsapp_numbers(tenant_id, phone_number_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, contact_id)
    REFERENCES whatsapp.contacts(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whatsapp.radar_selection_changes (
  tenant_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  contact_id BIGINT NOT NULL,
  seq BIGINT NOT NULL CHECK (seq > 0),
  ocid TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('interesting', 'dismissed')),
  candidate JSONB NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, phone_number_id, contact_id, seq),
  FOREIGN KEY (tenant_id, phone_number_id, contact_id)
    REFERENCES whatsapp.radar_selection_counters(tenant_id, phone_number_id, contact_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS whatsapp_radar_selection_changes_ocid
  ON whatsapp.radar_selection_changes(tenant_id, phone_number_id, contact_id, ocid, seq DESC);

CREATE TABLE IF NOT EXISTS whatsapp.radar_current_selections (
  tenant_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  contact_id BIGINT NOT NULL,
  ocid TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('interesting', 'dismissed')),
  seq BIGINT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, phone_number_id, contact_id, ocid),
  FOREIGN KEY (tenant_id, phone_number_id, contact_id, seq)
    REFERENCES whatsapp.radar_selection_changes(tenant_id, phone_number_id, contact_id, seq) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whatsapp.radar_meta_selections (
  tenant_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  contact_id BIGINT NOT NULL,
  meta_message_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, phone_number_id, contact_id, meta_message_id),
  FOREIGN KEY (tenant_id, phone_number_id, contact_id, seq)
    REFERENCES whatsapp.radar_selection_changes(tenant_id, phone_number_id, contact_id, seq) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS whatsapp.radar_sync_requests (
  tenant_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  contact_id BIGINT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, phone_number_id, contact_id, request_id),
  FOREIGN KEY (tenant_id, phone_number_id, contact_id)
    REFERENCES whatsapp.radar_selection_counters(tenant_id, phone_number_id, contact_id) ON DELETE CASCADE
);

COMMIT;
