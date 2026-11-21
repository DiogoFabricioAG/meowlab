-- Todos los gatos a la venta en Plan (ADR-0007 y ADR-0014 a ADR-0017) y Tender Cat en el catálogo.
-- Sin aplicar automáticamente; revisar en despliegue.
BEGIN;

ALTER TABLE billing_subscriptions DROP CONSTRAINT IF EXISTS billing_subscriptions_agents_check;
ALTER TABLE billing_subscriptions ADD CONSTRAINT billing_subscriptions_agents_check
  CHECK (cardinality(agents) BETWEEN 1 AND 7);

UPDATE billing_agents
   SET description = 'Emite tus facturas, boletas, notas y guías ante SUNAT desde WhatsApp.'
 WHERE key = 'invoice';

UPDATE billing_agents
   SET available = true,
       description = 'Registra tus ventas y arma cotizaciones con enlace desde el chat.'
 WHERE key = 'sales';

UPDATE billing_agents
   SET available = true,
       description = 'Controla tu inventario, costos y alertas de stock mínimo desde el chat.'
 WHERE key = 'stock';

UPDATE billing_agents
   SET available = true,
       description = 'Propone pedidos a proveedores cuando algo se acaba y hace seguimiento.'
 WHERE key = 'reorder';

UPDATE billing_agents
   SET available = true,
       description = 'Atiende a tus clientes 24/7 en tu WhatsApp y te pasa lo que necesita tu respuesta.'
 WHERE key = 'support';

UPDATE billing_agents
   SET available = true,
       description = 'Lleva tus cuentas por cobrar, recuerda a tus clientes y valida pagos.'
 WHERE key = 'collections';

INSERT INTO billing_agents (key, name, role_key, description, price_cents, available, sort) VALUES
  ('tender', 'Tender Cat', 'radar', 'Te avisa de licitaciones del Estado que encajan con tu negocio y te ayuda a preparar tu oferta.', 3500, true, 7)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  role_key = EXCLUDED.role_key,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  available = EXCLUDED.available,
  sort = EXCLUDED.sort;

COMMIT;
