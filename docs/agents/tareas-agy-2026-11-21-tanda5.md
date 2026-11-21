# Tareas para los agentes AGY — quinta tanda (21/11/2026)

Problemas que el operador encontró al revisar el portal en producción después del
despliegue conjunto (`docs/operations/despliegue-main-cad7f-2026-11-20.md`).

**Cómo se reparte:** los agentes de la tanda 4 terminan primero su tarea en curso.

- AGY-1 sigue con Sales Cat fase 3, AGY-2 con la activación de los gatos por pago y
  AGY-3 con Stock Cat fase 2.
- Las tareas de esta tanda las toma **el primer agente que quede libre**, en orden:
  **T1**, **T2**, **T3**, **T4**, **T5** y **T6**. Hay una para cada agente y una de reserva, así
  ninguno se queda sin trabajo.
- Antes de empezar, cada agente marca la tarea con su nombre en el tablero, para que
  otro no la tome.

Como siempre, quien coordina revisa, fusiona y despliega. **Ningún agente fusiona ni
despliega.**

Es un documento fechado. Si contradice al código o a `AGENTS.md`, mandan ellos.

---

## Reglas comunes

Valen las «Reglas comunes» de las tandas anteriores:

- [`tareas-agy-2026-11-20.md`](tareas-agy-2026-11-20.md);
- [`tareas-agy-2026-11-20-tanda2.md`](tareas-agy-2026-11-20-tanda2.md);
- [`tareas-agy-2026-11-20-tanda3.md`](tareas-agy-2026-11-20-tanda3.md);
- [`tareas-agy-2026-11-20-tanda4.md`](tareas-agy-2026-11-20-tanda4.md).

Además:

1. **`node_modules` real en tu worktree.** Corre `npm ci` en cada app que toques. Los
   junctions a `D:\meowlab` dan errores de tipos, porque esa copia tiene dependencias
   viejas.
2. **Revisión visual obligatoria para cambios de pantalla.**
   - Compila el portal y sírvelo localmente con un mock de `/api` (incluido
     `/api/auth/get-session`).
   - Adjunta al PR capturas a 1366 y 390 px.
   - Que las pruebas pasen no basta: en la tanda 4 la actividad pasaba las pruebas y en
     producción no cargaba.
3. **Contratos del bridge.** Si agregas una acción del portal, agrégala también a
   `isPortalCompanyRequest` en `src/bridge/portal-company-contracts.ts`, con su
   prueba de contrato. Ese olvido fue lo que dejó sin datos la actividad del Inicio.
4. **Mercado Pago está en producción.** No hagas compras ni llames a su API con las
   credenciales del VPS.

---

## T1 — Terminar: actividad legible, correo de Mercado Pago y Configuración nueva

- **Tareas del tablero:** `portal-actividad-numeros-duplicados-20261121`,
  `portal-plan-correo-mercadopago-20261121` y `portal-configuracion-ui-20261121`.
- **Rama de partida:** `origin/feat/portal-actividad-config-plan`, con el avance del
  coordinador (commit `25ebe`).
  - Créate un worktree en `D:/meowlab-wt-t1-portal` sobre esa rama, rebasada sobre
    `origin/main`.
  - Revisa el avance: no lo des por bueno.

### Qué reportó el operador

1. **«Actividad reciente» no se entiende.** Muestra «Invoice Cat emitió
   01m7j3emrtxy1f05x211j39pfd», repite la guía del 06/11 y mezcla pasos internos
   (borradores, ediciones).
2. **Plan pide el correo de Mercado Pago.** Mercado Pago exige, en las suscripciones
   (`preapproval`), el correo de la cuenta que paga. Pero el campo siempre visible
   confunde.
3. **Configuración se ve fea:**
   - una tarjeta de empresa a media pantalla con solo «Invoice Cat activo»;
   - la tarjeta de WhatsApp con otro estilo que el resto;
   - mucho espacio vacío.

### Lo que ya trae la rama (revisar y terminar)

- **Bridge (`src/node/portal/activity-service.ts`):**
  - solo muestra `invoice_issued`, `credit_note_created`, `invoice_cancelled` e
    `issue_despatch`, sin las guías en borrador;
  - deduplica por operación y recurso;
  - traduce el `resource_id` (es el `id` del comprobante; verificado: `01m7j3emrtx…` es
    F001-27) a número, cliente y total, con la lista `issued-documents` del servicio
    de facturación, en un rango de hasta 90 días;
  - nunca muestra un ID interno.
- **Portal:**
  - `HomeActivity.tsx` agrupa por día («Hoy», «Ayer», «Lunes, 16 nov.»), pone el nombre
    del gato en negrita y la hora a la derecha, muestra 8 acciones y luego «Ver las N
    acciones»;
  - `PlanPanel.tsx` oculta el correo detrás de «Pagarás con la cuenta de Mercado Pago
    de X. Usar otro correo» y abre el campo si Mercado Pago lo rechaza;
  - `SettingsPage.tsx` es nuevo: secciones con título a la izquierda (Tu cuenta,
    WhatsApp, Tu empresa) y el estado de cada gato con un enlace a su ficha o a Plan.
- **Pruebas:**
  - bridge: 20 en `portal-activity` y `portal-company`;
  - portal: 79.

### Qué falta

- **Revisión visual completa** de Inicio, Plan y Configuración a 1366 y 390 px. En
  Configuración había una diferencia de estilo entre tarjetas que se corrigió sin
  volver a mirarla.
- **Guías de remisión:** el servicio de facturación no las incluye en
  `issued-documents`. Busca de dónde sacar su número
  (`/api/invoicing/{tenant}/despatches` o equivalente) para escribir «Invoice Cat
  envió la guía T001-… a SUNAT». Si no hay forma barata, deja el texto actual sin
  número.
- **Resto de gatos en la actividad:**
  - revisa que sus textos digan algo útil, con cliente, monto o producto, y sin IDs;
  - Collections hoy dice «registró un cobro» dos veces por pago (`record_payment` y
    `approve_payment`): deja uno.
- **Configuración en celular:** comprueba que las secciones se apilen bien y que la
  lista de gatos se lea.
- **Pruebas:**
  - Worker completo, con la línea base de 2 fallas de Tender;
  - portal: `npm test`, `npm run typecheck` y `npm run build`.

### Archivos permitidos

- `apps/manolo-whatsapp-worker/src/node/portal/activity-service.ts` y sus pruebas.
- En `apps/meowlab-app/web/src`: `HomeActivity.tsx`, `PlanPanel.tsx`,
  `SettingsPage.tsx` y `Panel.tsx` (solo el cableado de Configuración).
- Las pruebas de esos archivos.
- **No toques** las tarjetas de Plan de cada gato ni la activación por pago: eso es
  de AGY-2 en la tanda 4.

### Terminado cuando

- El PR trae capturas antes y después de las tres pantallas, a 1366 y 390 px, con
  datos de ejemplo.
- Ninguna línea de la actividad muestra un ID interno ni se repite.
- Las tres tareas del tablero quedan en `done`.

---

## T2 — Alta de empresa sin RUC obligatorio y bienvenida con UI moderna

- **Tarea del tablero:** `portal-alta-sin-ruc-20261121`.
- **Worktree y rama:** `D:/meowlab-wt-t2-alta`, rama `feat/alta-empresa-sin-ruc`,
  desde `origin/main`.
- **Lectura obligatoria:**
  - `docs/decisions/0010-empresas-e-invitaciones-en-el-portal.md`;
  - `docs/decisions/0008-modelo-de-datos-erp.md`.

### Qué reportó el operador

- **El RUC obligatorio deja fuera a muchos negocios.** La pantalla de bienvenida
  («¿Con qué empresa vas a usar MeowLab?») solo deja crear la empresa con RUC
  («Buscar en SUNAT»). Eso solo importa para Invoice Cat. Sales, Stock, Collections,
  Reorder, Support y Tender pueden venderse a negocios **informales** o que no quieren
  dar su RUC por desconfianza.
- **La pantalla se ve anticuada.**

### Qué hacer

1. **Decisión primero.** Escribe una ADR nueva en `docs/decisions/`, con el siguiente
   número libre. Debe cubrir:
   - que una empresa puede existir sin RUC, con nombre comercial y, si quiere, rubro y
     ciudad;
   - que **Invoice Cat exige RUC**: al contratarlo o configurarlo, se pide el RUC y se
     valida con SUNAT como hoy;
   - qué pasa si después agrega el RUC: cómo se actualiza el nombre legal y cómo se
     evita duplicar una empresa que ya existe con ese RUC;
   - unicidad: sin RUC no hay forma de detectar duplicados. Propón la regla, por
     ejemplo un límite por cuenta.

   Si algo necesita una decisión del operador, déjalo en «Preguntas abiertas» y sigue
   con la opción más conservadora.
2. **Bridge:**
   - la acción `create` de `PortalCompanyService` (hoy devuelve `invalid_ruc` sin RUC)
     acepta crear con nombre y sin RUC;
   - agrega una acción para añadir el RUC después;
   - actualiza el contrato `isPortalCompanyRequest` y sus pruebas.
3. **Migración nueva del bridge** en `infra/postgres/migrations/`, si la columna del
   RUC o su unicidad lo exigen. Sin aplicar; revisa el siguiente número libre también
   en las ramas abiertas de AGY.
4. **Portal:**
   - **Bienvenida (`CompanyStep.tsx`, `OnboardingPage.tsx`):**
     - dos caminos claros: «Tengo RUC» (busca en SUNAT como hoy) y «Todavía no tengo
       RUC o prefiero no darlo» (nombre del negocio);
     - más «Me invitaron a una empresa».
   - **UI moderna**, con el mismo sistema que el resto del portal: tokens de
     `styles.css`, `PageHeader`, tarjetas `rounded-3xl` y `shadow-card`, botones
     grandes y clicables, y buen comportamiento a 390 px.
   - **Invoice Cat sin RUC:** donde se muestra, dice «Para emitir comprobantes,
     agrega el RUC de tu empresa», con un botón que lleva a agregarlo.
5. **Pruebas:**
   - crear sin RUC;
   - crear con RUC (sigue igual);
   - agregar el RUC después;
   - RUC ya tomado por otra empresa;
   - Invoice Cat bloqueado sin RUC;
   - aislamiento por tenant.

### Archivos permitidos

- `apps/manolo-whatsapp-worker/src/node/portal/company-service.ts`,
  `src/bridge/portal-company-contracts.ts`, sus pruebas e
  `infra/postgres/migrations/`.
- `apps/meowlab-app/server/` (las rutas de empresas), y en `web/src`:
  `CompanyStep.tsx`, `OnboardingPage.tsx`, y los textos de Invoice Cat en
  `agents.ts` y `AgentsPage.tsx`.
- La ADR nueva.
- **No toques** Plan ni la activación por pago (AGY-2) ni `SettingsPage.tsx` (T1).
  Si T1 todavía no está en `main`, coordina el rebase.

### Terminado cuando

- **Worker:** pasan `npm test` (con la línea base) y `npx tsc --noEmit`.
- **Portal:** pasan `npm test`, `npm run typecheck` y `npm run build`.
- **El PR trae:**
  - la ADR;
  - las migraciones que habrá que aplicar, en orden;
  - capturas de la bienvenida en los dos caminos, a 1366 y 390 px.
- La tarea del tablero queda en `done`.

---

## T3 — Pruebas de Tender Cat con reloj fijo (la suite del Worker en verde)

- **Tareas del tablero:** `radar-tests-clock-20261112` y `radar-tests-real-clock`.
- **Worktree y rama:** `D:/meowlab-wt-t3-reloj`, rama `test/tender-reloj-fijo`, desde
  `origin/main`.

### Problema

- `test/radar.test.ts` y `test/radar-routing.test.ts` usan la hora real.
- Tender Cat difiere los avisos fuera de la franja de 08:00 a 20:00 de Lima. De
  noche esas pruebas reciben `deferred` y esperan `accepted`.
- Por eso todas las tandas cargan una «línea base» de 2 fallas, que oculta fallas
  nuevas.

### Qué hacer

- Inyecta un reloj fijo, dentro de la franja, en esas dos pruebas: con
  `vi.useFakeTimers` y `vi.setSystemTime`, o con el reloj que ya acepte el runtime
  de Tender.
- **No cambies la política de horario.**
- Agrega una prueba que fije una hora **fuera** de la franja y espere `deferred`,
  para que la política quede cubierta.
- Si el pool de Workers no permite fake timers en ese camino, inyecta el reloj por
  dependencia con el menor cambio posible en `src/`, y explícalo en el PR.

### Archivos permitidos

- `apps/manolo-whatsapp-worker/test/radar.test.ts`, `test/radar-routing.test.ts` y,
  si hace falta, el punto de inyección del reloj en `src/` del runtime de Tender.

### Terminado cuando

- `npm test` del Worker, con `.dev.vars`, pasa **completo**, tanto de día como de noche.
  Corre la suite fijando las dos horas y muestra los resultados en el PR.
- `npx tsc --noEmit` pasa.
- Las dos tareas del tablero quedan en `done`.
- **Desde este PR**, las reglas comunes ya no aceptan la línea base de 2 fallas.

---

## T4 — Landing: subir Astro 5 a Astro 7 (vulnerabilidad crítica)

- **Tarea del tablero:** `landing-astro-7-20261120`.
- **Worktree y rama:** `D:/meowlab-wt-t4-astro`, rama `chore/landing-astro-7`, desde
  `origin/main`.

### Problema

`npm audit` marca una vulnerabilidad **crítica** en `astro <= 7.4.6` y otras
transitivas (`sharp`, `zod`, `esbuild`). La landing usa `astro ^5.3.0`, y el arreglo
exige subir de versión mayor.

### Qué hacer

- Lee las guías de migración oficiales de Astro de 5 a 6 y de 6 a 7.
- Sube `astro` y sus integraciones (`@astrojs/react`, `@astrojs/tailwind` u otras
  que use) a versiones compatibles.
- Usa **pnpm** y `pnpm-lock.yaml`; nunca `package-lock.json` en la raíz.
- Adapta solo lo que la migración obligue: configuración, View Transitions
  (`ClientRouter`), imports deprecados. **No cambies textos ni diseño.**
- Si alguna integración no tiene versión compatible, no la quites: anótalo y
  detente.

### Verificación

- `pnpm run check`, `pnpm test` y `pnpm run build` pasan.
- `pnpm audit` antes y después, en una tabla del PR.
- Revisión visual de `/`, `/precios/` y `/contacto/` a 1440, 1024, 768 y 390 px:
  - sin scroll horizontal;
  - las fuentes WOFF2 cargan;
  - los chats animados de `#gatos` funcionan (reproducción y botones);
  - capturas antes y después.
- Compila también la imagen con `Dockerfile.deploy` en local o en un contenedor
  temporal. **No la despliegues.**

### Archivos permitidos

- `package.json`, `pnpm-lock.yaml`, `astro.config.mjs`, `tsconfig.json` y lo mínimo
  en `src/` que la migración obligue.

### Terminado cuando

- El PR trae la tabla de `pnpm audit`, las capturas y la lista de cambios que obligó
  la migración.
- La tarea del tablero queda en `done`.

---

## T5 — Nombre propio de Sales Cat sin una consulta al bridge por cada mensaje

- **Tarea del tablero:** `sales-alias-sin-consulta-por-mensaje-20261121`.
- **Worktree y rama:** `D:/meowlab-wt-t5-alias`, rama `perf/sales-alias-cache`, desde
  `origin/main`.
- **Bloquea el despliegue del Worker** con Sales Cat fase 3 (PR #58).

### Problema

Lo detectó el coordinador al revisar el PR #58.

- En `src/index.ts`, por **cada mensaje normal** de un contacto (sin comando, sin
  botón, sin otra señal), el Worker toma la primera palabra con
  `leadingAliasCandidate` («Hola», «Emite», «Cuánto»…).
- Con esa palabra llama al bridge (`VpsSalesClient.resolveAlias`) para saber si es el
  nombre propio de Sales Cat.
- **Consecuencias:**
  - casi todos los mensajes suman un viaje de ida y vuelta al VPS antes de
    responder;
  - si el bridge está lento o caído, **cada mensaje espera el timeout** del cliente.

### Qué hacer

- **Sin consulta en cada mensaje.** Elige una de estas opciones o una equivalente:
  - guardar el nombre propio de la empresa del contacto en el estado que el Worker ya
    carga en cada turno, por ejemplo junto al rol efectivo que resuelve el bridge;
  - o una caché en D1 o en memoria con expiración corta (por ejemplo 5 minutos) que
    se invalide cuando la dueña cambia el nombre.
- **Si de todos modos hay que consultar,** que sea con un timeout corto (por ejemplo
  800 ms) y sin bloquear: ante cualquier error, el mensaje sigue su ruteo normal.
- **Pruebas:**
  - un mensaje normal no llama al bridge cuando no hace falta;
  - con el bridge caído, el mensaje se rutea igual y sin esperar;
  - el nombre propio sigue funcionando («Michi, ¿cuánto vendimos?»);
  - los comandos `/stock`, `/collections`, etc. no cambian.

### Archivos permitidos

- `apps/manolo-whatsapp-worker/src/index.ts` (solo este ruteo),
  `src/sales/cat-name.ts`, `src/sales/client.ts`, la respuesta del bridge que haga
  falta y sus pruebas.

### Terminado cuando

- Pasan `npm test` del Worker (con la línea base vigente) y `npx tsc --noEmit`.
- El PR explica la opción elegida y cuántas llamadas al bridge hace ahora un mensaje
  normal.
- La tarea del tablero queda en `done`.

---

## T6 — Plan como página de venta: arma tu equipo de gatos

- **Tarea del tablero:** `portal-plan-pagina-de-venta-20261121`.
- **Worktree y rama:** `D:/meowlab-wt-t6-plan`, rama `feat/plan-pagina-de-venta`,
  desde `origin/main`.
- **Depende de T1** (PR #65), que toca el correo de Mercado Pago en `PlanPanel.tsx`.
  Empieza cuando T1 esté en `main`, o rebasa sobre su rama y coordina.

### Qué reportó el operador

La pantalla de Plan es «sosa». Es una grilla de casillas con precio y una barra con
«S/ 0.00 al mes», el campo de correo y un botón. No vende: no explica qué gana la
dueña, no sugiere combinaciones y el descuento por cantidad pasa desapercibido. Pide
inspirarse en páginas que venden servicios por suscripción como el nuestro.

### Referencias para estudiar (solo estructura, no copies marca ni textos)

- **Precios con complementos por módulo:**
  - HubSpot (paquetes y «Starter Customer Platform»);
  - Zoho One;
  - Intercom (Fin como complemento).
- **SaaS de facturación y gestión para pymes de Latinoamérica:** Alegra, Siigo, Bind
  ERP. Observa cómo venden a la mype: lenguaje simple, IGV incluido, «sin contratos».
- **Ventas por WhatsApp en Latinoamérica:** Treble, Kommo.
- **Ejemplos de patrones:** Shopify y Notion (comparativas claras, preguntas
  frecuentes al pie, garantías visibles).

Anota en el PR qué patrón tomaste de cada referencia.

### Qué debe tener

1. **Encabezado que venda.**
   - Ejemplo: «Arma el equipo de gatos de tu negocio».
   - Debajo, una línea: «Pagas solo por los que usas. Cancela cuando quieras».
2. **Paquetes sugeridos** arriba, que se pueden elegir con un toque.
   - Ejemplos:
     - **«Empieza a vender»:** Sales e Invoice;
     - **«Tienda al día»:** Sales, Invoice, Stock y Collections;
     - **«Todo el equipo»:** los seis disponibles.
   - Cada paquete muestra el precio con su descuento y el ahorro en soles. Uno lleva el
     sello «Más elegido».
   - Los paquetes son preselecciones de gatos, no productos nuevos: el cobro sigue
     siendo la suscripción por gatos de ADR-0007.
3. **Tarjetas de gato:**
   - logo grande (`/agents/*-cat.webp`), nombre, precio al mes y tres beneficios
     concretos en una línea cada uno;
   - una etiqueta «Ideal si…», por ejemplo «Ideal si vendes por WhatsApp»;
   - estado claro: «En tu plan», «Agregar» o «Próximamente»;
   - Invoice Cat conserva la nota de la clave SOL;
   - los beneficios salen de las ADR de cada gato (0011 a 0017) y de la
     [matriz de participación](../project/matriz-participacion.md).
4. **Resumen fijo con el total.**
   - En escritorio, una columna a la derecha; en celular, una barra inferior fija.
   - Muestra los gatos elegidos, el subtotal, el descuento y el total del mes con IGV.
   - Incluye un incentivo: «Agrega 1 gato más y ahorra 15 %».
   - El botón principal va aquí.
   - El correo de Mercado Pago, como lo deja T1, solo aparece con «Usar otro correo».
5. **Confianza:**
   - logos de Mercado Pago, Yape y tarjetas (los permitidos por su marca);
   - «Cancela cuando quieras desde aquí»;
   - «Factura electrónica de tu suscripción», solo si es cierto. Si no, no lo
     pongas.
6. **Preguntas frecuentes:**
   - ¿Puedo cambiar de gatos?
   - ¿Qué pasa si cancelo?
   - ¿Necesito RUC?, coordinado con lo que defina T2.
   - ¿Cómo se activa cada gato?
7. **Si ya hay una suscripción:** arriba se ve el plan actual, la fecha del próximo
   cobro y el botón «Cambiar gatos».
8. **Sistema visual del portal:** tokens de `styles.css`, `PageHeader`, tarjetas
   `rounded-3xl` y `shadow-card`, Crete Round para títulos y Figtree para el texto.
   Sin librerías nuevas.

### Archivos permitidos

- `apps/meowlab-app/web/src/PlanPanel.tsx` y componentes nuevos en `web/src` para Plan.
- Los textos de `agents.ts` que use Plan.
- Las pruebas del portal.
- **No cambies** el cálculo de precios del servidor (`server/billing/pricing.ts`) ni el
  catálogo: el resumen debe dar el mismo total que el servidor. Agrega una prueba que
  lo compare.

### Terminado cuando

- Pasan `npm test`, `npm run typecheck` y `npm run build` del portal.
- El PR trae capturas a 1366 y 390 px de Plan sin suscripción, con un paquete
  elegido y con una suscripción activa, más la lista de referencias usadas.
- La tarea del tablero queda en `done`.

