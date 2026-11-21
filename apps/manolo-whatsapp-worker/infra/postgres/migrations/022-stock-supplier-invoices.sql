-- Stock Cat fase 2 (ADR-0014): proveedor y número de factura en movimientos,
-- más registro único para idempotencia de facturas de compra por proveedor y número.
BEGIN;

ALTER TABLE stock.moves
  ADD COLUMN IF NOT EXISTS supplier_name TEXT,
  ADD COLUMN IF NOT EXISTS supplier_ruc TEXT;

CREATE TABLE IF NOT EXISTS stock.supplier_invoices (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  supplier_key TEXT NOT NULL CHECK (length(supplier_key) BETWEEN 1 AND 200),
  document_number TEXT NOT NULL CHECK (length(document_number) BETWEEN 1 AND 64),
  supplier_name TEXT,
  supplier_ruc TEXT,
  contact_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, supplier_key, document_number)
);

COMMIT;
