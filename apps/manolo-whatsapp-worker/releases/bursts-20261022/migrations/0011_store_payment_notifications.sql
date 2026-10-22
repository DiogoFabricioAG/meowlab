CREATE TABLE IF NOT EXISTS store_payment_notifications (
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, order_id, payment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS store_payment_notifications_order_idx
  ON store_payment_notifications (tenant_id, order_id);
