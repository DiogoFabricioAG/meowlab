-- Independent notification capability. Does not modify tenants or role assignments.
CREATE TABLE radar_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  phone_number_id TEXT NOT NULL DEFAULT '',
  public_number TEXT NOT NULL DEFAULT ''
);
INSERT INTO radar_settings (id) VALUES (1);
CREATE TABLE radar_installations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  pairing_hash TEXT UNIQUE,
  pairing_expires_at INTEGER,
  phone_number_id TEXT NOT NULL,
  recipient TEXT,
  opted_in_at INTEGER
);
CREATE INDEX radar_installation_recipient ON radar_installations(phone_number_id, recipient);
CREATE TABLE radar_windows (
  phone_number_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  last_user_message_at INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (phone_number_id, recipient)
);
CREATE TABLE radar_inbound (
  message_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  processing_token TEXT NOT NULL,
  consumed INTEGER NOT NULL CHECK (consumed IN (0, 1))
);
CREATE TABLE radar_deliveries (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES radar_installations(id),
  phone_number_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  ocid TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'accepted', 'unknown', 'rejected')),
  provider_message_id TEXT,
  delivery_status TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (phone_number_id, recipient, ocid)
);
CREATE UNIQUE INDEX radar_provider_message ON radar_deliveries(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE radar_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
