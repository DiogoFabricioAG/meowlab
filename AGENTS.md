# Guía de agentes de MeowLab

Este archivo es el punto de entrada para cualquier agente que trabaje en este
repositorio. Su función es enrutar el trabajo hacia la documentación correcta,
no reemplazarla.

## Lectura obligatoria

Antes de modificar archivos:

1. Lee [`docs/README.md`](docs/README.md).
2. Lee [`docs/project/status.md`](docs/project/status.md) para conocer el estado
   real de la migración y las limitaciones activas.
3. Revisa el tablero de trabajo en
   [`docs/project/board.json`](docs/project/board.json): ubica tu tarea o
   agrégala si no existe.
4. Ejecuta `git status --short --branch` y conserva todos los cambios que ya
   existan. No asumas que un archivo sin commit puede descartarse.
5. Usa la tabla de enrutamiento de este documento y lee únicamente los
   documentos adicionales que correspondan al trabajo.

## Regla crítica: todo lo desplegado vive en git

Esta regla tiene prioridad sobre cualquier procedimiento de entrega,
script de `tools/` o costumbre previa. Motivo: la revisión del 2026-11-06
encontró en producción código que nunca se commiteó (RADAR, ráfagas,
migraciones D1 `0014`–`0019`) y releases armados desde `backups/`, que git
ignora. Si se perdía ese equipo, se perdía la única copia de lo que corre.

1. **Nada se despliega sin commit publicado.** Worker, bridge, migraciones D1 o
   PostgreSQL y landing salen únicamente de un commit que ya existe en
   `origin`. El acta del despliegue registra ese hash.
2. **Prohibido desplegar desde fuentes fuera de git**: working tree con cambios
   sin commit, `backups/`, `releases/` o un bundle parcheado. `backups/` es
   evidencia local, nunca fuente de verdad.
3. **Antes de desplegar**: los archivos del release están commiteados, se hizo
   `git push` y se despliega desde ese commit. Si no puedes cumplirlo, no
   despliegues y repórtalo como bloqueo.
4. **Migraciones**: toda migración aplicada en cualquier entorno se commitea
   en la misma entrega en que se aplicó.
5. **Al cerrar una tarea con cambios**, haz commit de tus archivos en una rama
   de trabajo (nunca directo en `main`). `push`, merge y despliegue siguen
   requiriendo autorización de la tarea. Si no puedes commitear, lista en tu
   reporte los archivos que quedan sin versionar como riesgo pendiente; nunca
   los presentes como trabajo terminado.
6. **No destruyas historia ni trabajo ajeno**: nada de `push --force`,
   `reset --hard`, `checkout --` o `clean` sobre cambios que no sean tuyos.

**Excepciones registradas.** Solo el operador puede autorizarlas, una por vez.
Desde el 2026-11-11 el Worker volvió a desplegarse desde un commit (`f679d352` desde `ba2ad51`); las dos
excepciones siguientes quedan cerradas y no habilitan nuevos injertos.

- 2026-11-06 — PDF de la guía de remisión publicado por injerto sobre el Worker
  `5a7c916e` (rama `feat/gre-pdf-formato`, `tools/prepare-gre-pdf-release.mjs`).
  Fuentes y scripts se commitearon y publicaron antes de desplegar; el bundle base
  sigue fuera de git. Antes de otra publicación hay que reconciliar `src/` con
  producción (tareas `git-version-production-code-20261106` y
  `wrangler-config-drift-20261106` del tablero).
- 2026-11-06 — Corrección de direcciones e imágenes en la GRE publicada por
  injerto sobre `c2070081` (`tools/prepare-gre-address-release.mjs`), autorizada
  por el operador tras la prueba real. Misma condición: fuentes y scripts
  commiteados y publicados antes de desplegar.

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
| Portal web app.meowlab.tech | [`docs/decisions/0006-portal-app-meowlab.md`](docs/decisions/0006-portal-app-meowlab.md) y `apps/meowlab-app/README.md` | `apps/meowlab-app/` |
| Coordinación de varios agentes | [`docs/project/board.json`](docs/project/board.json) y [`docs/agents/orchestration.md`](docs/agents/orchestration.md) | Tareas del tablero y límites de archivos definidos en el plan de trabajo |
| Una decisión estructural duradera | [`docs/decisions/README.md`](docs/decisions/README.md) | Nuevo ADR dentro de `docs/decisions/` |
| Documentación | [`docs/README.md`](docs/README.md) | `docs/`, este archivo y los README locales |

Las rutas de la tabla son acumulativas. Una modificación que cruza Worker y VPS
debe leer las dos filas correspondientes.

## Reglas arquitectónicas vigentes

- Meta tiene un solo webhook: el Cloudflare Worker. No se debe registrar el
  bridge del VPS, Vercel ni otra aplicación como callback paralelo. Los números
  conectados por Kapso llegan al mismo Worker por `/webhooks/kapso` (ADR-0009).
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
   despliegues ni hagas push o merge salvo que la tarea lo autorice, y aplica
   siempre la [regla crítica de git](#regla-crítica-todo-lo-desplegado-vive-en-git).

## Tablero de trabajo

El estado visible de las tareas vive en
[`docs/project/board.html`](docs/project/board.html), generado desde
[`docs/project/board.json`](docs/project/board.json) con columnas `todo`,
`in_progress` y `done`.

Reglas:

- Cada agente revisa el tablero al empezar. Si su tarea no está, la agrega en
  `todo` dentro de `board.json`.
- Al empezar a trabajar, mueve su tarea a `in_progress` (una sola tarea por
  agente a la vez).
- Al terminar y validar, la mueve a `done` con la evidencia: comando, prueba o
  archivo verificable.
- Si descubre trabajo nuevo durante la tarea, lo agrega a `todo` en la misma
  entrega; no lo deja únicamente en el chat.
- `board.json` es la fuente de verdad. No se edita `board.html` a mano: se
  regenera con `node tools/board/build-board.mjs` y se verifica con
  `node tools/board/build-board.mjs --check`.

## Definición de terminado

Un cambio está terminado cuando:

- cumple el comportamiento solicitado sin romper los otros dominios;
- mantiene aislamiento por tenant, autorización e idempotencia;
- no expone secretos ni datos sensibles en errores o logs;
- pasa las comprobaciones aplicables;
- deja documentación y contratos coherentes con el código;
- deja su tarea del tablero en `done` con evidencia y el HTML regenerado;
- queda commiteado en una rama de trabajo, o reportado explícitamente como
  pendiente de versionar con la lista de archivos;
- distingue claramente entre código probado, código desplegado y trabajo aún
  pendiente.
