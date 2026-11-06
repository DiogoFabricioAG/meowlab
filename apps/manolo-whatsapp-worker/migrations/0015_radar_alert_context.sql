-- Public opportunity facts only; no business profile, credentials or fiscal history.
CREATE TABLE radar_alert_context (
  delivery_id TEXT PRIMARY KEY REFERENCES radar_deliveries(id) ON DELETE CASCADE,
  facts_json TEXT NOT NULL CHECK(json_valid(facts_json)),
  message_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX radar_alert_context_expiry ON radar_alert_context(expires_at);
