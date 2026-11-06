-- Explicit one-off previews never reset automatic alert deduplication.
CREATE TABLE radar_alert_previews (
  delivery_id TEXT PRIMARY KEY REFERENCES radar_deliveries(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('sending','accepted','unknown','rejected')),
  provider_message_id TEXT,
  message_text TEXT,
  composition TEXT CHECK(composition IN ('ai','fallback')),
  created_at INTEGER NOT NULL
);
