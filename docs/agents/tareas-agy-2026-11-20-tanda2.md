# Tareas para los agentes AGY — segunda tanda del 20/11/2026

Segunda ronda para tres agentes en paralelo. Cada uno busca su sección
(**AGY-1**, **AGY-2** o **AGY-3**). Igual que en la primera tanda, quien
coordina revisa, fusiona y despliega. **Ningún agente fusiona ni despliega.**

Es un documento fechado. Si contradice al código o a `AGENTS.md`, mandan ellos.

---

## Reglas comunes

Valen todas las «Reglas comunes» de
[`tareas-agy-2026-11-20.md`](tareas-agy-2026-11-20.md): worktree propio desde
`origin/main`, no tocar `D:\meowlab` ni el flujo de Tender Cat, quedarse en tus
archivos, nada de despliegues ni datos de producción, tablero solo en tus
entradas, marca única, PR sin fusionar y reporte corto. Léelas primero.

Además, en esta tanda:

1. **Dependencias en un worktree nuevo.** Los worktrees no traen
   `node_modules`. Puedes enlazar los de `D:\meowlab` con un junction de
   Windows:

   ```powershell
   New-Item -ItemType Junction -Path <worktree>\<app>\node_modules -Target D:\meowlab\<app>\node_modules
   ```

   La excepción es AGY-3: va a cambiar dependencias, así que debe hacer
   `npm install` en su worktree y no usar junction.
2. **Pruebas del Worker.** `index.test.ts` y otras necesitan las variables de
   `apps/manolo-whatsapp-worker/.dev.vars`, que no están en git. Puedes copiar
   ese archivo de `D:\meowlab` a tu worktree para correr las pruebas, porque
   está en `.gitignore`. Bórralo al terminar y nunca lo commitees.
3. **Línea base conocida.** Con `.dev.vars`, en `main` fallan 2 pruebas:
   `radar.test.ts` y `radar-routing.test.ts`. Usan la hora real y pertenecen al
   flujo de Tender Cat. Cualquier otra falla es tuya.
4. **Migraciones.** Si tu tarea necesita una, escríbela como archivo nuevo, con
   el siguiente número libre. Revisa también las ramas
   `origin/feat/tender-*`: pueden haber tomado números. Nunca la apliques en
   ningún entorno y dilo en el PR.
5. **Tablero.** Tus tareas ya están en `in_progress` con tu nombre.

---

## AGY-1 — Facturación: error de extracción legible y marca MeowLab en el servicio

- **Tareas del tablero:** `facturaya-cambios-extraccion-422` y
  `facturaya-ai-marca-meowlab-20261120`.
- **Repos, worktrees y ramas:**
  - facturaya-ai: `D:/Proyectos2026/facturaya-wt-extraccion`, rama
    `fix/extraccion-422-y-marca`, desde `origin/main` de ese repo;
  - meowlab: `D:/meowlab-wt-facturacion-error`, rama
    `fix/facturacion-error-seguro`, solo para el adaptador del Worker.

### Parte 1: el 422 de extracción

- **Contexto:** cuando la API de borradores rechaza una extracción por
  validación (HTTP 422), el usuario de WhatsApp recibe un mensaje genérico y
  nadie puede saber después qué regla falló.
  - `InvoiceDraftController` guarda `raw_extraction` solo cuando la validación
    pasa.
  - El adaptador del Worker (`apps/manolo-whatsapp-worker/src/adapters/facturaya/client.ts`,
    función `safeMessage`) ignora `data.error`.
- **Qué hacer en facturaya-ai:**
  - Si la validación falla, conservar `raw_extraction` y registrar qué reglas
    fallaron, en el borrador o en un log estructurado. Sin datos personales
    completos: el DNI o RUC enmascarado y sin nombres.
  - Devolver en el 422 un `data.error` con un `code` estable y un `message`
    corto en español, apto para mostrárselo a la dueña. Ejemplo:
    «Falta el precio de "polos"».
  - Pruebas Feature para el 422: el contenido de la respuesta y que
    `raw_extraction` se conserva.
- **Qué hacer en meowlab:**
  - `safeMessage` debe leer también `data.error.message` y `data.error.code`.
  - Solo se muestra un mensaje que venga de un `code` conocido; si no, el texto
    genérico de siempre.
  - Pruebas en `test/` del Worker.
- **Archivos permitidos:**
  - en facturaya-ai: controlador, request o validador, modelo y pruebas de
    borradores; y una migración solo si de verdad hace falta;
  - en meowlab: `src/adapters/facturaya/client.ts` y sus pruebas.

### Parte 2: marca en facturaya-ai

- Las vistas Blade `resources/views/platform/companies.blade.php`,
  `invoices/create.blade.php` y `despatches/index.blade.php` muestran
  «FacturaYa AI».
- Revisa también los PDF (`app/Services/*PdfService.php`), los correos
  (`app/Mail`, `app/Notifications`) y cualquier texto que vea un cliente.
- Cambia «FacturaYa» por «MeowLab» o «Invoice Cat», según corresponda.
- **No cambies:** el nombre del repo, los namespaces, `APP_NAME` del `.env`,
  las rutas ni los identificadores.

### Pruebas de facturaya-ai

No hay PHP local. Corre la suite en un contenedor temporal en el VPS con la
imagen que está en ejecución, sin tocar los contenedores vivos:

```sh
git archive HEAD | ssh meowlab 'd=$(mktemp -d); tar -x -C $d; IMG=$(docker inspect facturaya-ai-app-1 --format "{{.Config.Image}}"); docker run --rm -v $d:/src -w /src --entrypoint sh $IMG -c "composer install -q --no-interaction && php artisan key:generate -q --force && vendor/bin/phpunit"; rm -rf $d'
```

Ajusta el comando si hace falta (por ejemplo, `.env` de prueba o SQLite). Es
aceptable que siga fallando `CompanyAdministrationTest::test_visual_workspaces_are_available`,
porque falta el manifiesto de Vite.

### Terminado cuando

- Hay dos PR, uno por repo, con pruebas.
- El PR de facturaya-ai incluye un ejemplo del JSON del 422 antes y después.
- En `resources/views`, `app/Mail` y `app/Notifications` de facturaya-ai, un
  `git grep -i facturaya` ya no muestra texto visible para el usuario.

---

## AGY-2 — Portal: tendencia por día y actividad de los gatos en el Inicio

- **Tarea del tablero:** `portal-inicio-series-y-actividad-20261119`.
- **Worktree y rama:** `D:/meowlab-wt-portal-actividad`, rama
  `feat/portal-series-actividad`.

### Objetivo

Hoy el Inicio del portal (`apps/meowlab-app/web/src/WeeklyHome.tsx`) muestra
cuatro cifras de la semana, «Para atender» y «Tus gatos hoy». Faltan dos
piezas:

1. **Tendencia por día:** una gráfica pequeña de los últimos 14 días para dos o
   tres cifras clave, como comprobantes emitidos, monto vendido y cobros
   registrados. Solo de los gatos activos de la empresa.
2. **Actividad reciente:** una lista con hora de lo que hicieron los gatos.
   Ejemplos: «10:42 · Collections Cat envió un recordatorio a Bodega Rosita»,
   «09:15 · Invoice Cat emitió F001-28».

### Cómo

- **Investiga primero:**
  - de dónde saca hoy el portal la semana: el endpoint del portal y la
    operación del bridge que lo alimenta (busca `weekly(` en
    `apps/manolo-whatsapp-worker/src/node/`);
  - qué tablas ya guardan eventos con hora. Collections, Reorder y Support
    tienen `audit_log` en PostgreSQL.
- **Bridge:**
  - agrega una operación de solo lectura que devuelva las series por día y la
    actividad reciente de una empresa (por ejemplo, 30 eventos);
  - arma la actividad uniendo los `audit_log` existentes antes de crear tablas
    nuevas;
  - si hace falta una tabla o vista nueva, va como migración sin aplicar (regla
    común 4);
  - respeta el aislamiento por tenant y la firma HMAC de las rutas privadas.
- **Portal:**
  - pide esos datos y dibújalos en el Inicio con los tokens de
    `web/src/styles.css`;
  - gráfica en SVG propio, sin librerías nuevas;
  - estados vacío y de error escritos para la dueña.
- **Textos de la actividad:** salen en primera persona del gato o con su
  nombre, sin «Manolo», «RADAR» ni «FacturaYa».

### Archivos permitidos

- `apps/manolo-whatsapp-worker/src/node/` (servicios y ruteo del bridge) y sus
  pruebas;
- `apps/manolo-whatsapp-worker/infra/postgres/migrations/`, solo si hace falta;
- `apps/meowlab-app/`: el servidor del portal, `web/src/WeeklyHome.tsx`, un
  componente nuevo para la gráfica y la actividad, y sus pruebas.

### Cuidado

- El flujo de Tender Cat tiene cambios del portal sin fusionar
  (`feat/tender-plataforma-nativa`).
- Toca lo mínimo en archivos compartidos como `Panel.tsx` o el ruteo del
  servidor, para que su fusión no choque.
- Nada de Tender Cat en la actividad por ahora.

### Terminado cuando

- Pasan:
  - Worker: `npm test` (con la línea base conocida) y `npx tsc --noEmit`;
  - portal: `npm test` y `npm run build`.
- Hay pruebas nuevas del bridge, del aislamiento por tenant y del armado de la
  actividad, y del cálculo de las series en el portal.
- El PR trae capturas del Inicio con datos de ejemplo, que pueden salir de un
  mock local del `/api`, y del estado vacío.

---

## AGY-3 — Landing: dependencias seguras, lint y pruebas

- **Tareas del tablero:** `npm-audit` y `lint-y-pruebas-landing`.
- **Worktree y rama:** `D:/meowlab-wt-landing-calidad`, rama
  `chore/landing-audit-lint-pruebas`.

### Parte 1: `npm audit`

- **Alcance:** `npm install` y `npm audit` en la raíz (la landing) y en
  `apps/meowlab-app`.
- **Qué arreglar:** lo que se arregle con actualizaciones de versión menor o de
  parche (`npm audit fix`, sin `--force`).
- **Qué hacer con un salto de versión mayor:** no lo apliques. Anótalo en el PR
  con el paquete, la vulnerabilidad, si afecta en producción o solo en
  desarrollo, y la versión que lo arreglaría.
- **Worker** (`apps/manolo-whatsapp-worker`): solo reporta. No cambies sus
  dependencias, porque `wrangler` y el pool de pruebas de Cloudflare son
  delicados.
- **Después de actualizar**, todo debe seguir compilando:
  - landing: `npm run build`;
  - portal: `npm test` y `npm run build`.

### Parte 2: lint y pruebas para la landing

- Agrega `astro check` como script `check`. Corrige lo que marque, sin cambiar
  textos.
- Agrega pruebas con Vitest, que ya se usa en el repo, para:
  - `src/scripts/chat.ts`: el escape de HTML, el formato `*negrita*` y que una
    conversación termine con `onEnd`;
  - `src/components/landing/chats.ts`: que cada gato tenga su conversación, que
    los `handoff` usen actores existentes en `ACTORS` y que los `tap` y
    `branches` apunten a botones que existen.
- Un script `test` en el `package.json` de la raíz que corra esas pruebas.
- Si hace falta un entorno DOM para `chat.ts`, usa `happy-dom` o `jsdom` como
  dependencia de desarrollo y anótalo en el PR.

### Reglas propias

- **Archivos permitidos:**
  - `package.json` y `package-lock.json` de la raíz y de `apps/meowlab-app`;
  - archivos de configuración nuevos de Vitest y Astro check en la raíz;
  - `test/landing/` o similar;
  - y lo mínimo en `src/` para que pase `astro check`, sin cambiar textos ni
    diseño.
- **No toques** `apps/meowlab-app/web/src`: es de AGY-2. Si `npm audit fix` del
  portal solo cambia los dos archivos de paquetes, no hay conflicto.

### Terminado cuando

- El PR trae `npm audit` antes y después, por proyecto (cantidad por severidad).
- `npm run check`, `npm test` y `npm run build` pasan en la raíz.
- El portal sigue pasando `npm test` y `npm run build`.
- Las dos tareas del tablero quedan en `done`.
