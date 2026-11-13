-- ADR-0013: una sola plantilla para los documentos; la cotización de Sales Cat se entrega
-- como PDF. Se retira el kit de marca de la 015 (sin datos en producción al retirarlo) y se
-- guarda el PDF de cada cotización la primera vez que se genera, para que el cliente vea
-- siempre lo mismo aunque la plantilla cambie. Sin almacenamiento externo por ahora: cada
-- PDF pesa decenas de KB y viaja con los respaldos de la base (ver ADR-0013, «Blob storage»).
BEGIN;

DROP TABLE IF EXISTS commerce.brand_logos;
DROP TABLE IF EXISTS commerce.brand_kits;
ALTER TABLE sales.quotes DROP COLUMN IF EXISTS payment_terms;
ALTER TABLE sales.quotes DROP COLUMN IF EXISTS delivery_terms;

CREATE TABLE IF NOT EXISTS sales.quote_files (
  quote_id UUID PRIMARY KEY REFERENCES sales.quotes(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 100 AND 2097152),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS quote_files_tenant ON sales.quote_files (tenant_id);

COMMIT;
