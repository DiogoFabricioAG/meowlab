-- Operational availability only: no hostnames, business profile or private tender files.
CREATE TABLE radar_presence (
  installation_id TEXT PRIMARY KEY REFERENCES radar_installations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence>0),
  online INTEGER NOT NULL CHECK(online IN (0,1)),
  alerts_enabled INTEGER NOT NULL CHECK(alerts_enabled IN (0,1)),
  last_seen_at INTEGER NOT NULL
);
CREATE VIEW radar_presence_active AS
  SELECT i.id AS installation_id,i.phone_number_id,i.recipient,p.online,p.last_seen_at
  FROM radar_installations i JOIN radar_presence p ON p.installation_id=i.id
  JOIN radar_settings s ON s.id=1 AND s.enabled=1 AND s.phone_number_id=i.phone_number_id
  WHERE i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL AND i.recipient IS NOT NULL AND p.alerts_enabled=1;
CREATE TABLE radar_presence_groups (
  phone_number_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('online','offline','paused')),
  revision INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0,
  last_notified_state TEXT,
  PRIMARY KEY(phone_number_id,recipient)
);
CREATE TABLE radar_presence_notices (
  id TEXT PRIMARY KEY,
  phone_number_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('online','offline')),
  state TEXT NOT NULL CHECK(state IN ('sending','accepted','unknown','rejected')),
  created_at INTEGER NOT NULL,
  provider_message_id TEXT,
  delivery_status TEXT,
  UNIQUE(phone_number_id,recipient,revision)
);
CREATE INDEX radar_presence_notice_time ON radar_presence_notices(phone_number_id,recipient,created_at);
CREATE UNIQUE INDEX radar_presence_provider ON radar_presence_notices(provider_message_id) WHERE provider_message_id IS NOT NULL;
