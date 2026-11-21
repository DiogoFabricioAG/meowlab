-- Sales Cat fase 3 (ADR-0011): metas mensuales por empresa, nombre propio del gato
-- y enlace explícito entre ventas al crédito y deudas en Collections Cat.
BEGIN;

-- Nombre propio del gato por empresa (decisión 2).
ALTER TABLE sales.settings ADD COLUMN IF NOT EXISTS cat_name TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_cat_name_check') THEN
    ALTER TABLE sales.settings ADD CONSTRAINT sales_settings_cat_name_check
      CHECK (cat_name IS NULL OR (char_length(trim(cat_name)) BETWEEN 2 AND 20 AND cat_name !~* '(https?://|www\.)'));
  END IF;
END $$;

-- Metas mensuales de venta por empresa (decisión 16), en céntimos de sol y mes calendario de Lima (YYYY-MM).
CREATE TABLE IF NOT EXISTS sales.monthly_goals (
  tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  target_cents BIGINT NOT NULL CHECK (target_cents > 0),
  updated_by_contact_id BIGINT,
  updated_by_portal_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, month)
);

-- Enlace explícito venta-deuda en Collections Cat (decisión 9).
ALTER TABLE receivables.debts ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales.sales(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS debts_tenant_sale
  ON receivables.debts (tenant_id, sale_id) WHERE sale_id IS NOT NULL;

COMMIT;
