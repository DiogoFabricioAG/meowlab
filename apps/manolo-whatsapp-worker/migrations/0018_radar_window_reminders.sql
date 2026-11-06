-- Explicit desktop preference. Existing/paused installations remain opted out.
CREATE TABLE radar_reminder_preferences (
  installation_id TEXT PRIMARY KEY REFERENCES radar_installations(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX radar_delivery_recipient_time ON radar_deliveries(phone_number_id, recipient, created_at);
