-- Cobro por empresa (ADR-0007, nota del 13/11/2026): cada empresa tiene su propia
-- suscripción y sus agentes; quien paga es su titular. Sales Cat pasa a venderse y se
-- activa en la plataforma hasta el fin del periodo pagado.
BEGIN;

ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS tenant_id TEXT
  CHECK (tenant_id IS NULL OR tenant_id ~ '^[A-Za-z0-9_.:-]{1,128}$');
-- Hasta dónde se avisó a la plataforma: si el aviso falla, la conciliación lo repite.
ALTER TABLE billing_subscriptions ADD COLUMN IF NOT EXISTS entitlement_applied_until TIMESTAMPTZ;

-- Una suscripción viva por empresa. Las anteriores, sin empresa, siguen siendo por cuenta.
DROP INDEX IF EXISTS billing_subscriptions_one_live;
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_one_live_company
  ON billing_subscriptions (tenant_id)
  WHERE tenant_id IS NOT NULL AND status IN ('creating', 'pending', 'authorized', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_one_live_account
  ON billing_subscriptions (user_id)
  WHERE tenant_id IS NULL AND status IN ('creating', 'pending', 'authorized', 'paused');

UPDATE billing_agents
   SET available = true, description = 'Registra tus ventas y arma cotizaciones con enlace desde el chat.'
 WHERE key = 'sales';

COMMIT;
