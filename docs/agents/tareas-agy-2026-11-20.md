# Tareas para los agentes AGY — tanda del 20/11/2026

Este documento asigna trabajo a tres agentes que corren en paralelo. Cada uno
busca su sección (**AGY-1**, **AGY-2** o **AGY-3**), cumple las reglas comunes
y entrega un PR. Quien coordina (Claude Code, en la sesión del operador) revisa,
fusiona y despliega. Ningún agente fusiona ni despliega.

Es un documento fechado. Si contradice al código o a `AGENTS.md`, mandan ellos.

---

## Reglas comunes (las tres sesiones)

1. **Lectura mínima antes de tocar nada:** `AGENTS.md` (sobre todo la regla
   crítica de git), `docs/project/status.md` y tu sección de este documento.
   Si necesitas contexto de producto, `docs/agents/traspaso-2026-11-18.md`.
2. **Trabaja en tu propio worktree**, creado desde `origin/main`, con la rama y
   la carpeta que indica tu sección. **No toques `D:\meowlab`**: es la copia de
   otra sesión y puede tener cambios sin commitear.
3. **No toques el flujo de Tender Cat:** las ramas `feat/tender-*`, los worktrees
   `D:/meowlab-wt-tender-*`, ni los archivos `src/roles/radar-*.ts` del Worker.
4. **Quédate dentro de tus archivos.** Cada sección lista lo que puedes editar.
   Si necesitas tocar algo fuera de esa lista, no lo hagas: anótalo en tu
   reporte como pendiente.
5. **Prohibido:**
   - desplegar (Worker, bridge, portal, landing o facturación);
   - aplicar migraciones o escribir en datos de producción;
   - usar el teléfono de prueba +51 951 307 245;
   - escribir secretos en archivos, commits o el reporte;
   - agregar `.env`, `.dev.vars` o `secrets/`;
   - `push --force`, `reset --hard`, `clean` o `checkout --` sobre trabajo ajeno.

   El VPS (`ssh meowlab`) se puede usar **solo para leer**, salvo que tu sección
   diga otra cosa.
6. **Tablero:** tus tareas ya están en `in_progress` con tu nombre en
   `docs/project/board.json`. Al terminar, pásalas a `done` con evidencia
   (comando, prueba o archivo) y regenera con
   `node tools/board/build-board.mjs` y `--check`. Edita **solo tus entradas**;
   si encuentras trabajo nuevo, agrégalo en `todo`. Antes de abrir el PR,
   rebasa sobre `origin/main` y, si `board.json` choca, conserva las entradas
   de los demás tal como estén.
7. **Marca única:** en todo texto que vea un usuario (landing, portal,
   WhatsApp, PDF) no se escribe «RADAR» ni «FacturaYa». Se dice «Tender Cat»,
   «Invoice Cat», «la facturación de MeowLab» o «MeowLab». Los nombres técnicos
   internos (repo `facturaya-ai`, servicios `radar-*`, identificadores, actas)
   no cambian.
8. **Entrega:**
   - commits pequeños en tu rama, mensajes en español, terminados con tu línea
     de coautoría habitual;
   - `git push -u origin <tu-rama>`;
   - PR contra `main` con: qué cambió, pruebas ejecutadas con su resultado y
     riesgos pendientes;
   - **no fusiones**;
   - al final, en la interfaz, un reporte corto con: rama, PR, archivos
     tocados, pruebas y lo que quedó pendiente.

---

## AGY-1 — Marca única: fuera «RADAR» y «FacturaYa» de lo que ven los usuarios

- **Tareas del tablero:** `marca-unica-sin-radar-facturaya-20261120` y
  `portal-inicio-nombre-meowlab-20261116`.
- **Worktree y rama:** `D:/meowlab-wt-marca`, rama `feat/marca-unica-20261120`.

### Objetivo

Que ninguna pantalla, mensaje de WhatsApp ni PDF que vea un cliente diga
«RADAR», «FacturaYa» o «Manolo». Desde el 20/11 todo es MeowLab y sus gatos.

### Dónde está (medido en `main`)

- **Landing:** `src/pages/index.astro` (FAQ) y `src/components/AgentesDetalle.astro`.
- **Portal:**
  - `apps/meowlab-app/web/src/agents.ts`, `CompanyStep.tsx` e `InvoicingPanel.tsx`;
  - `WeeklyHome.tsx`, que dice «el chat de Manolo»: cambiar a «el chat de MeowLab»;
  - busca también «Manolo» en el resto de `apps/meowlab-app/web/src/`.
- **Worker:** textos de WhatsApp en `apps/manolo-whatsapp-worker/src/roles/`:
  `cat-role.ts`, `enterprise-advisor-role.ts`, `enterprise-despatch.ts` y
  `sales-role.ts`. Hay unos 60. Ejemplo: «FacturaYa no encontró el nombre
  para ese DNI» pasa a «No encontré el nombre para ese DNI».
- **Prompts del modelo** que el Worker manda a la IA: si le dicen al modelo que
  se presente como FacturaYa o RADAR, cámbialo. Un nombre interno que el
  usuario nunca lee puede quedarse.

### Reglas propias

- **Fuera de alcance:**
  - `src/roles/radar-*.ts`, que pertenecen al flujo de Tender Cat;
  - identificadores, nombres de variables, rutas, tablas, logs internos y actas;
  - el repo `facturaya-ai`. Si su PDF o sus correos muestran «FacturaYa» al
    cliente, anótalo como tarea `todo` nueva en el tablero; no lo edites.
- **Escribe para la dueña de una mype:** frases cortas, en primera persona
  cuando habla el gato («Emití tu factura», no «FacturaYa emitió…»).
- **Pruebas:** actualiza las que comparan textos exactos. No cambies lógica.
- **Landing:** solo cambias texto. No toques CSS, fuentes ni `public/`, que
  son de AGY-3.

### Terminado cuando

- `git grep -n -i "facturaya\|radar\|manolo"` sobre `src/pages`,
  `src/components`, `apps/meowlab-app/web/src` y los cuatro archivos de roles
  ya no muestra textos visibles para el usuario. Pega en el PR la salida,
  con los restos internos justificados.
- Pasan:
  - Worker: `cd apps/manolo-whatsapp-worker && npm test && npx tsc --noEmit`;
  - portal: `cd apps/meowlab-app && npm test && npm run build`;
  - landing: `npm run build` en la raíz.
- El PR incluye una tabla «antes → después» con los textos más visibles, unos
  15 como máximo.

---

## AGY-2 — Backend y operaciones: reloj de Collections y Caddyfile vivo en git

- **Tareas del tablero:** `collections-remind-clock-20261120` y
  `vps-caddyfile-drift-20261111`.
- **Worktrees y ramas:**
  - meowlab: `D:/meowlab-wt-collections`, rama `fix/collections-remind-clock`;
  - facturaya-ai: `D:/Proyectos2026/facturaya-wt-caddy`, rama
    `ops/caddyfile-vivo`, creada desde `origin/main` de ese repo.

### Parte 1: `CollectionsService.remind()` debe usar el reloj inyectado

- **Problema:** `remind()` escribe `receivables.debts.last_reminder_at` y
  `receivables.reminders.created_at` con `CURRENT_TIMESTAMP` de PostgreSQL e
  ignora `this.now()`. Con eso no se pueden simular días.
  `apps/manolo-whatsapp-worker/tools/collections-pg-check.ts` lo compensa con
  `syncReminderTimestamp()`.
- **Qué hacer:**
  - Busca el servicio con `git grep -n "class CollectionsService"`.
  - Pasa `this.now()` como parámetro en esos INSERT y UPDATE, y en cualquier
    otro `CURRENT_TIMESTAMP` del mismo servicio que dependa del reloj de
    negocio.
  - Quita `syncReminderTimestamp()` del check.
- **Archivos permitidos:** el servicio de Collections, sus pruebas y
  `tools/collections-pg-check.ts`. Sin migraciones: si crees que hace falta
  una, detente y repórtalo.
- **Prueba:** agrega o ajusta una prueba unitaria que fije el reloj y compruebe
  que `last_reminder_at` sale de él. Corre `npm test` y `npx tsc --noEmit` en
  el Worker. Si puedes, corre también el check contra un PostgreSQL local o
  efímero, nunca contra producción.

### Parte 2: llevar a git el Caddyfile que corre en el VPS

- **Problema:** `/opt/facturaya-ai/docker/caddy/Caddyfile` (el vivo, con
  bloques de debt-hub y radar) difiere de `docker/caddy/Caddyfile.vps` del repo
  `facturaya-ai`. Además, `/opt/facturaya-ai` no es un repo git. Nadie debe
  cambiar el bloque de `app.meowlab.tech` hasta que la versión viva esté
  versionada.
- **Qué hacer (solo lectura en el VPS):**
  1. `ssh meowlab 'cat /opt/facturaya-ai/docker/caddy/Caddyfile'` y compáralo
     con `docker/caddy/Caddyfile.vps`.
  2. Revisa que no tenga secretos (tokens, claves básicas, IP privadas
     sensibles). Si los tiene, reemplázalos por variables `{$NOMBRE}` en la
     copia versionada y anótalo en el PR. **No cambies el archivo del VPS.**
  3. Actualiza `docker/caddy/Caddyfile.vps` en el repo `facturaya-ai` para que
     sea idéntico al vivo, salvo esos reemplazos.
  4. Agrega `docs/caddy-vivo-2026-11-20.md` en `facturaya-ai` con:
     - qué bloques sirve hoy (dominio → contenedor y puerto);
     - qué difería respecto al repo;
     - cómo comprobar en el futuro que el VPS y el repo siguen iguales
       (`diff` por ssh).
- **Validación:** `docker run --rm -v <ruta>:/etc/caddy/Caddyfile:ro
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`. Si validar
  exige las variables de entorno, documenta cuáles. Puedes correrlo en el VPS
  con un archivo temporal en `/tmp`, que borras después.

### Terminado cuando

- Hay dos PR, uno en `meowlab` y otro en `facturaya-ai`, cada uno con sus
  pruebas.
- En el tablero, las dos tareas pasan a `done`. El tablero vive solo en meowlab.
- No cambió nada en el VPS, salvo archivos temporales en `/tmp` ya borrados.

---

## AGY-3 — Landing: fuentes en WOFF2 y revisión en tablet

- **Tareas del tablero:** `landing-fuentes-woff2-20261113` y
  `landing-tablet-revision-20261113`.
- **Worktree y rama:** `D:/meowlab-wt-landing-perf`, rama
  `perf/landing-woff2-tablet`.

### Parte 1: fuentes WOFF2

- La landing sirve Blinker y Actor en TTF, unos 284 KB. `perf.mjs` lo marca
  como advertencia.
- **Qué hacer:**
  - Convierte las fuentes a WOFF2 (por ejemplo con `npx ttf2woff2` o
    `fonttools`) y subconjunta a latín con los acentos y signos del español
    (á é í ó ú ü ñ ¿ ¡ « » S/ –) si eso reduce peso sin perder glifos.
  - Actualiza los `@font-face` y los `preload` para servir WOFF2. Deja el TTF
    como respaldo solo si hace falta.
  - Mantén `font-display: swap`.
- **Medición:** peso antes y después de cada fuente, y la salida de `perf.mjs`
  sin esa advertencia.

### Parte 2: anchos de tablet (768 a 1024 px)

- La revisión visual solo se hizo a 1440 y 390 px.
- **Qué hacer:**
  - Revisa la landing a 768, 820, 912 y 1024 px de ancho, y también a 1280 px
    con zoom del 90 %, donde el operador ya vio un problema.
  - Usa el navegador sin cabeza que prefieras. Si no tienes uno, un script con
    Playwright o Puppeteer en una carpeta temporal, sin agregarlo a
    `package.json`.
  - Corrige desbordes horizontales, textos cortados, tarjetas apretadas y los
    teléfonos de demostración demasiado angostos (el texto del campo de
    mensaje debe leerse).
- **No cambies** el diseño de escritorio ni el móvil de 390 px: compáralos
  antes y después.

### Reglas propias

- **Archivos permitidos:** `public/fonts/` (o donde estén las fuentes),
  `src/styles/`, el layout que declara las fuentes, y los estilos y el marcado
  de los componentes, solo para el responsive.
- **No edites textos:** AGY-1 está cambiando el FAQ de `index.astro` y
  `AgentesDetalle.astro`. Si tienes que tocar esos archivos por CSS o
  estructura, no cambies ni una palabra del contenido, y rebasa antes del PR.
- No agregues dependencias al `package.json` de la raíz sin anotarlo en el PR.

### Terminado cuando

- `npm run build` en la raíz pasa.
- El PR trae:
  - capturas antes y después a 768 y 1024 px, guardadas fuera del repo y
    adjuntas en el PR o descritas si no puedes adjuntarlas;
  - la tabla de pesos de las fuentes.
- No hay scroll horizontal en ningún ancho entre 360 y 1440 px. Compruébalo con
  `document.documentElement.scrollWidth <= innerWidth`.
- Las dos tareas del tablero quedan en `done`.
