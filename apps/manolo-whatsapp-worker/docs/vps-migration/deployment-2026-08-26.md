# Runtime de plataforma en PostgreSQL VPS - 2026-08-26

## Resultado

Se completó la siguiente preparación de la migración sin cambiar el tráfico de
Meta ni el callback del Worker:

- Migración aplicada: `005-platform-runtime.sql`.
- Servicio PostgreSQL: `manolo-platform-postgres-1`.
- Servicio Node: `manolo-platform-bridge-1`.
- Estado del bridge: `healthy`.
- Conteos actuales en PostgreSQL: 2 tenants, 8 contactos, 8 conversaciones y
  566 mensajes.
- La copia de mensajes fue reconciliada contra la exportación D1 del
  2026-08-26.
- Reconciliación posterior verificada el 2026-08-27: D1 y PostgreSQL tienen
  566 mensajes, sin claves `meta_message_id` duplicadas; el esquema de negocio
  quedó en 57 clientes, 258 ventas, 168 pagos y 10 compras.

## Cambios de base de datos

El esquema `whatsapp` ahora incluye las tablas preparatorias:

- `conversation_sessions`: una sesión operativa por contacto, con rol,
  estado, contexto JSON y vencimiento explícito.
- `idempotency_keys`: deduplicación general por tenant, ámbito y clave de
  solicitud.

Estas tablas todavía no reciben tráfico del Worker. Se prepararon primero para
que la migración del runtime pueda activarse detrás de una bandera y validarse
con pruebas de sombra.

## Estado del tráfico

El Worker continúa usando D1 para tenant lookup, conversaciones, historial,
estados de roles y cotizaciones. PostgreSQL VPS sigue siendo la autoridad de
roles y el origen del `print-advisor` mediante el puente HMAC.

No se retiró D1 ni se modificó el webhook de Meta. El rollback sigue consistiendo
en desactivar las rutas VPS y conservar la ejecución anterior del Worker.

## Próximo corte controlado

Antes de activar PostgreSQL como runtime de conversaciones se debe:

1. Implementar el contrato firmado de `platform runtime`.
2. Añadir repositorio PostgreSQL equivalente al contrato de conversaciones.
3. Ejecutar escritura en sombra y comparar deduplicación, historial y estados.
4. Resolver la dependencia de identificadores de contacto de los roles que aún
   viven en D1.
5. Activar primero un tenant de prueba y observar errores, latencia y conteos.
