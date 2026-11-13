-- Keep the original preview ledger for rollback and preserve all prior outcomes.
-- A new standard permits one explicitly requested preview, never arbitrary retries.
CREATE TABLE radar_alert_preview_versions (
  delivery_id TEXT NOT NULL REFERENCES radar_deliveries(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK(format IN ('text-v1','buttons-v1')),
  state TEXT NOT NULL CHECK(state IN ('sending','accepted','unknown','rejected')),
  provider_message_id TEXT,
  message_text TEXT,
  composition TEXT CHECK(composition IN ('ai','fallback')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(delivery_id,format)
);
INSERT INTO radar_alert_preview_versions
  (delivery_id,format,state,provider_message_id,message_text,composition,created_at)
SELECT delivery_id,'text-v1',state,provider_message_id,message_text,composition,created_at
FROM radar_alert_previews;
