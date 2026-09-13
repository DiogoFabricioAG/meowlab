# Plataforma Manolo

## Alcance

`apps/manolo-whatsapp-worker` contiene dos ejecutables relacionados:

1. Cloudflare Worker, único webhook de Meta y gateway de WhatsApp.
2. Bridge Node para el VPS, detrás de Caddy y conectado a PostgreSQL.

Comparten contratos TypeScript, pero tienen despliegues y secretos distintos.

## Roles registrados

| Rol | Responsabilidad principal | Dependencias relevantes |
| --- | --- | --- |
| `cat` | Personalidad predeterminada de Manolo | IA conversacional |
| `quotes` | Borrador, correlativo y PDF de cotización | D1, Groq, Browser Run, Meta |
| `print-advisor` | Consultas analíticas del negocio | Bridge VPS, Groq, PostgreSQL/D1 |
| `store-designer` | Diseño, configuración, pedido y pago de tienda | API privada de tienda |
| `enterprise-advisor` | Facturación empresarial multiempresa | OpenAI compatible, VPS, FacturaYa, R2 |

El rol efectivo del contacto puede sobrescribir el rol base del tenant. Un rol
desconocido cae en `cat`, pero no reescribe la configuración persistida.

## Regla para añadir un rol

1. Define contratos del dominio fuera del handler si hay un proveedor externo.
2. Implementa el adaptador detrás de ese contrato.
3. Crea un `RoleHandler` en `src/roles/`.
4. Regístralo en `src/roles/registry.ts`.
5. Añade el rol al catálogo PostgreSQL si debe asignarse desde la TUI.
6. Decide dónde vive su estado y documenta la fuente de verdad.
7. Añade pruebas unitarias del handler, errores, reintentos e interacciones.
8. Verifica que texto, audio, imagen y documento conserven la personalidad y el
   flujo del rol cuando sean entradas válidas.

Los modelos y credenciales pertenecen a configuración y factorías, no al
constructor del rol. Si varios roles requieren configuraciones diferentes, se
debe evolucionar hacia un catálogo de proveedor/modelo por tenant o rol sin
crear lógica condicional dispersa.

## Persistencia

### D1

Las migraciones contienen tenants, números, bot configs, contactos,
conversaciones, mensajes, cotizaciones, correlativos compartidos, estado de
roles y notificaciones de tienda. Las migraciones históricas de funcionalidades
retiradas se conservan sin reactivarlas ni usarlas desde el runtime.

### PostgreSQL VPS

Los scripts `init/` crean los esquemas `whatsapp` y `print_system`. Las
migraciones versionadas agregan solicitudes del bridge, control de roles,
runtime preparatorio y FacturaYa multiempresa.

No modifiques una migración desplegada. Crea la siguiente versión y proporciona
una ruta de rollback o una estrategia compatible.

## Seguridad

- Firma de Meta sobre bytes originales.
- HMAC y tolerancia temporal para Worker → VPS.
- Deduplicación por ID de Meta y claves de idempotencia por dominio.
- Tokens FacturaYa cifrados en el VPS y descifrados únicamente durante la
  operación autorizada.
- Consultas de Print Advisor en modo de solo lectura.
- Logs estructurados sin mensajes, teléfonos, documentos ni secretos.
- Límite de tamaño para cuerpo HTTP y documentos.

## Administración

La TUI principal se ejecuta con `npm run users:tui` y administra PostgreSQL por
SSH. La TUI D1 existe solo para compatibilidad de grupos de cotizaciones.

El README detallado de la aplicación es
[`apps/manolo-whatsapp-worker/README.md`](../../apps/manolo-whatsapp-worker/README.md).
Debe actualizarse cuando cambie un rol, variable o flujo operativo específico.
