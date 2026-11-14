-- Sales Cat se vende en el Plan del portal, por empresa (ADR-0007, nota del 13/11/2026).
-- Una suscripción pagada habilita Sales Cat hasta el fin del periodo pagado
-- (`active_until`); al vencer deja de estar activo sin borrar datos. Las activaciones
-- manuales (piloto de CREACIONES J&D) son cortesía: sin vencimiento y el cobro no las toca.
BEGIN;

ALTER TABLE sales.settings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'courtesy';
ALTER TABLE sales.settings ADD COLUMN IF NOT EXISTS active_until TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_settings_source_check') THEN
    ALTER TABLE sales.settings ADD CONSTRAINT sales_settings_source_check
      CHECK (source IN ('courtesy', 'subscription') AND (source = 'subscription' OR active_until IS NULL));
  END IF;
END $$;

COMMIT;
