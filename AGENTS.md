# Guía de agentes de MeowLab

Este archivo es el punto de entrada para cualquier agente que trabaje en este
repositorio. Su función es enrutar el trabajo hacia la documentación correcta,
no reemplazarla.

## Lectura obligatoria

Antes de modificar archivos:

1. Lee [`docs/README.md`](docs/README.md).
2. Lee [`docs/project/status.md`](docs/project/status.md) para conocer el estado
   real de la migración y las limitaciones activas.
3. Ejecuta `git status --short --branch` y conserva todos los cambios que ya
   existan. No asumas que un archivo sin commit puede descartarse.
4. Usa la tabla de enrutamiento de este documento y lee únicamente los
   documentos adicionales que correspondan al trabajo.

## Enrutamiento por tipo de tarea

En las filas de Manolo, las rutas abreviadas `src/`, `test/`, `migrations/`,
`infra/` y `tools/` son relativas a `apps/manolo-whatsapp-worker/`.

| Si la tarea afecta... | Lee primero | Código o configuración principal |
| --- | --- | --- |
| Navegación, contenido, componentes o marca de la landing | [`docs/apps/landing.md`](docs/apps/landing.md) | `src/`, `public/`, `astro.config.mjs`, `tailwind.config.mjs` |
| Webhook de Meta, normalización multimodal o envío por WhatsApp | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) y [`docs/architecture/current-system.md`](docs/architecture/current-system.md) | `apps/manolo-whatsapp-worker/src/index.ts`, `src/whatsapp/`, `src/adapters/whatsapp/` |
| Roles, prompts, memoria o conversaciones | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) | `apps/manolo-whatsapp-worker/src/roles/`, `src/conversations/`, `src/ai/` |
| FacturaYa o multiempresa | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) y el README local del Worker | `src/facturaya/`, `src/adapters/facturaya/`, `src/node/facturaya/` |
| Print Advisor o consultas del negocio | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) | `src/roles/print-advisor-role.ts`, `src/adapters/print-system/`, `src/node/bridge/print-advisor-service.ts` |
| Cotizaciones y PDF | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) | `src/roles/quote-role.ts`, `src/quotes/`, migraciones D1 `0005` a `0009` |
| Facturación empresarial y FacturaYa | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) | `src/roles/enterprise-advisor-role.ts`, `src/facturaya/`, `src/adapters/facturaya/`, `src/node/facturaya/` |
| Tienda virtual | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) | `src/roles/store-designer-role.ts`, `src/adapters/store-designer/`, `src/store-*` |
| Worker, D1, R2, Browser Run o Wrangler | [`docs/operations/deployment.md`](docs/operations/deployment.md) | `apps/manolo-whatsapp-worker/wrangler.jsonc`, `migrations/` |
| Bridge Node, HMAC, Caddy, Docker o PostgreSQL del VPS | [`docs/operations/deployment.md`](docs/operations/deployment.md) y el runbook del VPS | `src/node/`, `src/bridge/`, `infra/vps/`, `infra/postgres/` |
| Migración D1 a PostgreSQL o arquitectura futura | [`docs/architecture/current-system.md`](docs/architecture/current-system.md) y el documento fundacional | `docs/vps-migration/`, `docs/architecture-foundation.md`, `src/node/platform/` |
| TUI de contactos, roles o empresas | [`docs/apps/manolo-platform.md`](docs/apps/manolo-platform.md) | `tools/users-tui-vps.mjs`, `tools/users-tui/` |
| Pruebas, revisión o CI | [`docs/development/validation.md`](docs/development/validation.md) | `test/`, `vitest.config.ts`, scripts de ambos `package.json` |
| Coordinación de varios agentes | [`docs/agents/orchestration.md`](docs/agents/orchestration.md) | Límites de archivos definidos en el plan de trabajo |
| Una decisión estructural duradera | [`docs/decisions/README.md`](docs/decisions/README.md) | Nuevo ADR dentro de `docs/decisions/` |
| Documentación | [`docs/README.md`](docs/README.md) | `docs/`, este archivo y los README locales |

Las rutas de la tabla son acumulativas. Una modificación que cruza Worker y VPS
debe leer las dos filas correspondientes.

## Reglas arquitectónicas vigentes

- Meta tiene un solo webhook: el Cloudflare Worker. No se debe registrar el
  bridge del VPS, Vercel ni otra aplicación como callback paralelo.
- El estado actual es híbrido. D1 sigue ejecutando el runtime principal de
  conversaciones, deduplicación, estados y cotizaciones; PostgreSQL recibe
  mensajes en sombra y ya es la autoridad para roles, permisos y FacturaYa.
- `VPS_PLATFORM_SHADOW_ENABLED` no convierte automáticamente PostgreSQL en el
  runtime principal. El retiro de D1 requiere un corte explícito y verificable.
- Worker → VPS usa cuerpo firmado con HMAC, timestamp y request ID. No se deben
  crear rutas privadas sin el mismo límite de confianza.
- Los roles dependen de contratos. Un rol no debe conocer directamente las
  credenciales ni la implementación HTTP de Meta, Groq, OpenAI o FacturaYa.
- Los secretos se almacenan en Cloudflare Secrets o Docker Secrets según el
  proceso consumidor. Nunca se documentan valores reales ni se agregan archivos
  `.env`, `.dev.vars` o directorios `secrets/` al repositorio.
- PostgreSQL no se expone públicamente. Caddy es la entrada del bridge y la TUI
  opera por SSH.
- `tienda-virtual` conserva código de integración, pero está fuera del alcance
  de la migración actual al VPS hasta una nueva decisión.
- La landing y Manolo comparten repositorio, no despliegue. Cada aplicación
  mantiene comandos, dependencias, secretos y ciclo de entrega propios.

## Fuentes de verdad

Ante una contradicción, usa este orden:

1. Código, configuración desplegable y migraciones versionadas.
2. [`docs/project/status.md`](docs/project/status.md) y
   [`docs/architecture/current-system.md`](docs/architecture/current-system.md).
3. README de la aplicación involucrada.
4. Inventarios y reportes fechados, que son evidencia histórica y no estado en
   tiempo real.
5. Texto comercial de la landing.

No actualices documentación histórica para hacerla parecer actual. Añade una
nueva nota fechada o corrige el documento de estado.

## Protocolo de cambio

1. Delimita el dominio y los archivos que vas a tocar.
2. Revisa contratos y pruebas existentes antes de cambiar la implementación.
3. Conserva compatibilidad con los demás roles y con la deduplicación de Meta.
4. Añade una migración nueva; no reescribas una migración que ya pudo ejecutarse
   en producción.
5. Ejecuta la validación proporcional indicada en
   [`docs/development/validation.md`](docs/development/validation.md).
6. Si cambió una frontera, fuente de verdad, variable, ruta o procedimiento,
   actualiza la documentación en la misma entrega.
7. Reporta archivos modificados, pruebas ejecutadas y riesgos pendientes. No
   despliegues ni hagas commit salvo que la tarea lo autorice.

## Definición de terminado

Un cambio está terminado cuando:

- cumple el comportamiento solicitado sin romper los otros dominios;
- mantiene aislamiento por tenant, autorización e idempotencia;
- no expone secretos ni datos sensibles en errores o logs;
- pasa las comprobaciones aplicables;
- deja documentación y contratos coherentes con el código;
- distingue claramente entre código probado, código desplegado y trabajo aún
  pendiente.
