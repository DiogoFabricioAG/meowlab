CREATE UNIQUE INDEX IF NOT EXISTS store_payment_notifications_order_idx
  ON store_payment_notifications (tenant_id, order_id);
