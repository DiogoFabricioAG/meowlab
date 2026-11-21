# Tareas para los agentes AGY — tercera tanda del 20/11/2026

Tercera ronda para tres agentes en paralelo. Cada uno busca su sección (**AGY-1**,
**AGY-2** o **AGY-3**). Quien coordina revisa, fusiona y despliega. **Ningún agente
fusiona ni despliega.**

Es un documento fechado. Si contradice al código o a `AGENTS.md`, mandan ellos.

---

## Reglas comunes

Valen las «Reglas comunes» de [`tareas-agy-2026-11-20.md`](tareas-agy-2026-11-20.md)
y las de [`tareas-agy-2026-11-20-tanda2.md`](tareas-agy-2026-11-20-tanda2.md):
junctions de `node_modules`, `.dev.vars` copiado y borrado, línea base de 2 pruebas
de Tender Cat, migraciones sin aplicar y tablero solo en tus entradas. Léelas
primero.

Además, en esta tanda:

1. **Verificación de tipos obligatoria en el portal.** `npm run build` no revisa
   tipos. En `apps/meowlab-app` corre también `npm run typecheck`. En la tanda
   anterior se escapó un error por no hacerlo.
2. **La landing usa pnpm.** Si tocas dependencias de la raíz, usa `pnpm` y
   `pnpm-lock.yaml`. Nunca agregues `package-lock.json` en la raíz.
3. **Archivos compartidos entre AGY-1 y AGY-2.** Los dos tocan pantallas de
   `apps/meowlab-app/web/src`:
   - AGY-1 cambia las llamadas `fetch`;
   - AGY-2 cambia los encabezados.

   Son líneas distintas. Antes de abrir el PR, rebasa sobre `origin/main` y
   resuelve conservando los cambios de ambos.
4. **Tablero.** Tus tareas ya están en `in_progress` con tu nombre.

---

## AGY-1 — App Android, fase 1: el portal empaquetado con Capacitor

- **Tarea del tablero:** `app-movil-1-shell-20261120`.
- **Worktree y rama:** `D:/meowlab-wt-app-movil`, rama `feat/app-movil-fase-1`.
- **Lectura obligatoria:**
  [`docs/decisions/0018-app-movil-android-capacitor.md`](../decisions/0018-app-movil-android-capacitor.md).
  Esta tarea es su fase 1. No contradigas la ADR; si algo no se puede hacer como
  dice, explícalo en el PR.

### Qué hacer

1. **`apiFetch()` en el portal**
   - Un módulo, por ejemplo `web/src/api.ts`, que antepone
     `import.meta.env.VITE_API_ORIGIN`. Vacío en la web.
   - Reemplaza todas las llamadas `fetch("/api…")` y `fetch(\`/api…\`)` de
     `web/src` (unas 12) y el `createAuthClient` de `auth-client.ts` (`baseURL`).
   - **Sin `VITE_API_ORIGIN`, la web debe comportarse exactamente igual que hoy**:
     cookies, `credentials: "same-origin"` y rutas relativas.
   - Agrega pruebas de `apiFetch`.
2. **Sesión con token en la app**
   - Activa el plugin `bearer` de better-auth en `server/auth.ts`.
   - En la app, el cliente guarda el token en almacenamiento seguro del
     dispositivo (Keystore). Elige un plugin mantenido y justifícalo en el PR.
     Nunca uses `localStorage`.
   - Lo manda en `Authorization` cuando corre dentro de Capacitor
     (`Capacitor.isNativePlatform()`).
   - La web sigue igual, con cookies.
3. **CORS y orígenes en el servidor del portal**
   - Acepta el origen `https://localhost`, que es el de Capacitor en Android.
     Solo ese, con `Authorization` y sin cookies.
   - Agrégalo a los orígenes de confianza de better-auth (`TRUSTED_ORIGINS`) por
     configuración, no fijo en código.
   - **Pruebas del servidor:**
     - un token de un usuario no da acceso a empresas de otro;
     - el CORS rechaza cualquier otro origen.
4. **`apps/meowlab-mobile`**
   - Proyecto Capacitor con `appId: "tech.meowlab.app"`, `appName: "MeowLab"` y
     `webDir` apuntando a la compilación del portal (`../meowlab-app/dist`). Pon
     las dependencias de Capacitor en su propio `package.json`, no en el del
     portal.
   - Proyecto `android/` generado y versionado, sin `local.properties`, sin
     claves de firma y sin `google-services.json`. Esos tres van al
     `.gitignore`.
   - Ícono y splash con la marca. Usa `public/assets/landing/meowlab-mark.png` o
     el logo del portal.
   - Botón atrás de Android: navega hacia atrás y, en la raíz, cierra la app.
   - Enlaces externos (`https://wa.me/…`, descargas de PDF) se abren fuera de la
     app.
   - Pantalla sin conexión propia.
   - Scripts:
     - `build:web`: compila el portal con `VITE_API_ORIGIN`;
     - `sync`: `cap sync android`;
     - `apk:debug`: Gradle `assembleDebug`.
   - Un `README.md` con los requisitos (Android Studio, JDK 21 del JBR de Android
     Studio, `ANDROID_HOME`) y los comandos.
5. **Prueba en emulador**
   - Construye el APK de depuración e instálalo en un emulador de Android
     Studio. **No uses el teléfono +51 951 307 245.**
   - Para iniciar sesión, levanta el portal local (`npm run dev` en
     `apps/meowlab-app`, que usa D1 local). Compila la app con
     `VITE_API_ORIGIN=http://10.0.2.2:<puerto>`, que es el host visto desde el
     emulador.
   - Si `http` exige ajustar la configuración de red solo para depuración, hazlo
     solo en el build de depuración y anótalo.
   - Adjunta al PR capturas del emulador:
     - el login;
     - el Inicio con sesión iniciada;
     - la pantalla sin conexión;
     - un enlace `wa.me` abriendo fuera de la app.

### Fuera de alcance

- Notificaciones push y Firebase (fase 2).
- Firma de release, AAB y Play Console (fase 3).
- No despliegues el portal: el cambio del servidor (CORS y bearer) se desplegará
  cuando se fusionen las ramas de Tender Cat.

### Terminado cuando

- En el portal pasan `npm test`, `npm run typecheck` y `npm run build`. Con
  `VITE_API_ORIGIN` vacío, el `dist` hace las mismas llamadas que antes.
- En `apps/meowlab-mobile`, `npm run build:web`, `npm run sync` y
  `npm run apk:debug` funcionan en una máquina con Android Studio.
- El PR trae las capturas, el plugin elegido para el token y lo que haya quedado
  pendiente.

---

## AGY-2 — Portal: encabezado estándar en todas las páginas

- **Tarea del tablero:** `portal-page-header-20261120`.
- **Worktree y rama:** `D:/meowlab-wt-page-header`, rama `feat/portal-page-header`.

### Problema, pedido por el operador

- **Cada página escribe su propio encabezado.**
  - Invoice, Collections, Stock, Reorder y Support usan
    `h1 text-3xl font-bold tracking-tight` con un logo de 48 px.
  - Tender Cat (solo en ramas sin fusionar) usa `sm:text-4xl`, sin negrita, y un
    logo de 44 px.
- **Las páginas de agentes ponen arriba el botón «← Tus agentes»**, de 44 px más
  `space-y-6`. Por eso su título queda unos 70 px más abajo que en Inicio, Tus
  agentes, Plan, Negocio o Configuración.

### Qué hacer

1. **Un componente `PageHeader`** en `apps/meowlab-app/web/src/PageHeader.tsx`
   con:
   - una **fila superior de altura fija** en todas las páginas. En las de
     agentes lleva «← Tus agentes» como enlace pequeño (`text-sm`, área táctil de
     al menos 44 px sin agrandar la fila; usa padding negativo o un área
     transparente). En las generales lleva el nombre de la empresa activa o
     queda vacía con la misma altura;
   - `title`, `subtitle` opcional y `agent` opcional, que dibuja el logo de 48 px
     en su caja mint;
   - `actions` opcional, alineado a la derecha, para botones como «Exportar».
2. **Úsalo en todas las páginas:**
   - generales: `WeeklyHome`, `AgentsPage` (lista), `PlanPanel`, `AdminPanel`,
     Configuración en `Panel.tsx`;
   - agentes: `AgentsPage` (detalle), `InvoicingPanel`, `CollectionsPanel`,
     `StockPanel`, `ReorderPanel`, `SupportPanel`.

   El título queda a la misma distancia del borde superior en todas. Mídelo.
3. El saludo del Inicio («Buenas noches, …») usa el mismo tamaño y peso que los
   demás títulos.
4. Pruebas del componente: las dos variantes y que la fila superior exista
   siempre.

### Cuidado

- No toques `TenderList.tsx`: está solo en las ramas de Tender Cat y lo adopta
  esa sesión al fusionar. Anota en el PR el cambio que deberá hacer.
- AGY-1 está cambiando las llamadas `fetch` de esos mismos archivos (regla común
  3).
- No cambies textos salvo lo necesario para el encabezado.

### Terminado cuando

- En el portal pasan `npm test`, `npm run typecheck` y `npm run build`.
- El PR trae una tabla con la posición `top` del `h1` en cada página, medida en
  Chrome headless a 1280 y 390 px (todas iguales), y capturas antes y después de
  Inicio, Invoice Cat y Collections Cat a 1280 px.

---

## AGY-3 — Dependencias con salto mayor y la prueba de Vite en facturación

- **Tareas del tablero:** `portal-hono-node-server-2-20261120`,
  `worker-npm-audit-dev-20261120` y `facturaya-test-vite-manifest-20261120`.
- **Worktrees y ramas:**
  - meowlab: `D:/meowlab-wt-deps`, rama `chore/deps-salto-mayor`;
  - facturaya-ai: `D:/Proyectos2026/facturaya-wt-vite-test`, rama
    `test/sin-manifiesto-vite`.

### Parte 1: `@hono/node-server` 2 en el portal (afecta producción)

- `npm audit` marca una vulnerabilidad moderada en `@hono/node-server` 1.x.
  `apps/meowlab-app/server/node.ts` usa `serve` y `serveStatic`.
- Sube a la versión 2 que la corrige. Lee su guía de migración y adapta
  `server/node.ts`.
- **Comprueba que el servidor Node sirve igual que antes:**
  - `npm run build:node`;
  - levanta `build/server.mjs` localmente;
  - `/`, una ruta del SPA (por ejemplo `/agentes`), un asset con hash y una ruta
    `/api` inexistente (debe dar 404 JSON, no el `index.html`).
- Pasan `npm test`, `npm run typecheck` y `npm run build`.

### Parte 2: dependencias de desarrollo del Worker

- `npm audit` en `apps/manolo-whatsapp-worker` da 12 vulnerabilidades (3
  moderadas y 9 altas), todas de desarrollo y pruebas (`miniflare`, `wrangler`,
  `@cloudflare/vitest-pool-workers`, `vite`).
- Sube `@cloudflare/vitest-pool-workers`, `vitest` y `wrangler` a las versiones
  compatibles entre sí que las corrijan. Sigue la tabla de compatibilidad de
  Cloudflare.
- La suite debe seguir igual: con `.dev.vars`, solo pueden fallar las 2 pruebas
  conocidas de Tender Cat. `npx tsc --noEmit` debe pasar.
- **No despliegues ni corras `wrangler deploy`.** Si `wrangler` nuevo cambia el
  formato de `wrangler.jsonc` o pide migrar algo, no lo apliques: anótalo en el
  PR.
- **Si el salto rompe la suite y no se arregla con cambios pequeños**, deja el
  Worker como está y documenta por qué. Una actualización a medias no sirve.

### Parte 3: la prueba que falla por el manifiesto de Vite (facturaya-ai)

- `CompanyAdministrationTest::test_visual_workspaces_are_available` falla en
  cualquier entorno sin `public/build/manifest.json`.
- Haz que las pruebas no dependan de los assets compilados. Por ejemplo,
  `$this->withoutVite()` en el `TestCase` base o en esa prueba, si la versión de
  Laravel lo permite.
- La suite completa debe pasar al 100 % en el contenedor temporal del VPS
  (comando en la tanda 2, sección AGY-1).
- Al terminar, borra el directorio temporal desde un contenedor, porque los
  archivos quedan con dueño del contenedor:

  ```sh
  docker run --rm -v /tmp:/t --entrypoint rm <imagen> -rf /t/<dir>
  ```

### Terminado cuando

- Hay dos PR, meowlab y facturaya-ai.
- El de meowlab trae `npm audit` antes y después del portal y del Worker.
- Las tres tareas del tablero quedan en `done`, o con la explicación de lo que
  no se pudo.
