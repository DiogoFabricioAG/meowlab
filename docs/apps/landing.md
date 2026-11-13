# Landing MeowLab

## Propósito

La aplicación raíz es la presencia comercial de MeowLab (meowlab.tech). Presenta
los agentes ("gatos") que trabajan dentro del mismo chat de WhatsApp con Manolo y
lleva al portal `https://app.meowlab.tech`. No procesa webhooks ni comparte
runtime con Manolo.

## Stack y rutas

- Astro 5, salida estática por directorio.
- Inicio (`/`): sistema del kit taste-skill (`public/taste/`), sin Tailwind.
- Páginas internas: Tailwind CSS 3 (`src/styles/global.css`, con
  `applyBaseStyles: false` en `astro.config.mjs` para que el reset de Tailwind no
  llegue al inicio).
- Tipografías locales Blinker (títulos) y Actor (texto) en `public/fonts`,
  declaradas en `src/styles/fonts.css`. No se cargan fuentes desde un CDN.
- Sin `ClientRouter`: cada página carga completa (los scripts del kit corren una
  sola vez por carga).

| URL | Archivo |
| --- | --- |
| `/` | `src/pages/index.astro` con `src/layouts/LandingLayout.astro` |
| `/contacto` | `src/pages/contacto.astro` |
| `/privacidad` | `src/pages/privacidad.astro` (datos en `src/data/legal.ts`) |
| `/terminos` | `src/pages/terminos.astro` (datos en `src/data/legal.ts`) |

Las páginas internas usan `src/layouts/Layout.astro` con `Navbar.astro` y
`Footer.astro`, que repiten la navegación y las columnas del inicio. Las legales
usan `src/components/LegalPage.astro`.

## Inicio (rediseño 2026-11-13, método taste-skill)

Tipo de página: software (`data-type`, `page-type` y `site-kind` = software).
Acción principal: «Entrar al portal» → `https://app.meowlab.tech` (en la barra,
el hero y el cierre).

| Sección | Contenido | Visual |
| --- | --- | --- |
| hero (`split`) | h1 «Agentes de IA en WhatsApp para mypes peruanas», precio de Invoice Cat | chat de WhatsApp con Manolo en HTML |
| `#portal` | qué muestra app.meowlab.tech | ventana del portal (lista del día y una factura abierta); momento `iris-opens` |
| `#facturas` | Invoice Cat: facturas, boletas y guías ante SUNAT con FacturaYa | chat de una guía de remisión |
| `#un-chat` | todos los gatos en el mismo chat | frase con momento `word-highlight` y los siete gatos |
| `#licitaciones` | Tender Cat y el SEACE | aviso en el chat y lista del portal |
| `#equipo` | invitar al equipo con un enlace de WhatsApp | invitación del portal y chat |
| `#agentes` | los siete agentes, estado y precio mensual con IGV, descuentos por paquete, Mercado Pago | ilustraciones de los gatos |
| `#preguntas` | preguntas frecuentes | — |
| pie (`footer.closing`) | cierre «Empieza con Invoice Cat por S/ 39 al mes» y columnas | — |

Componentes en `src/components/landing/` (`LandingNav`, `LandingFooter`,
`WaChat`). CSS de página en `src/styles/landing.css` (solo lo que va dentro de
los visuales). Las ilustraciones derivadas de los gatos de la marca están en
`public/assets/landing/` (WebP pequeños generados desde los PNG del repo).

Hechos que la página puede afirmar: hoy funcionan Invoice Cat y Tender Cat;
Sales, Stock, Reorder, Support y Collections Cat se muestran como
«Próximamente». Precios mensuales con IGV: Invoice S/ 39, Sales S/ 59, Stock
S/ 29, Reorder S/ 25, Support S/ 39, Collections S/ 25, Tender S/ 35. Descuentos:
2 agentes 10 %, 3–4 agentes 15 %, 5–6 agentes 20 %. Los nombres, montos y series
que aparecen dentro de los chats y del portal son datos de demostración de la
interfaz, no clientes.

### El kit taste-skill

`public/taste/` es una copia sin cambios de los archivos del kit que usa la
página (`system.css`, `system.js`, `layout/`, `motion/`, `moments/`, `ui/`). No
se editan: el gate compara cada archivo con el del skill (`kit-edited`). Para
actualizar el kit se vuelve a copiar desde `<skill>/assets`.

### Comprobaciones (taste-skill)

Se ejecutan contra el build (`pnpm build`, luego `--root dist`). `<skill>` es la
carpeta del skill `taste-skill`; los archivos de trabajo quedan en
`.taste-skill/` (ignorado por git salvo `waivers.json`).

```bash
pnpm build
node <skill>/scripts/copy-lint.mjs dist/index.html --kind software
node <skill>/scripts/consistency.mjs dist/index.html --root dist --widths 1440,1024,820,768,390 --rhythm-widths 1440,820,768,390 --profile .taste-skill/chrome-cons --page software --category "agentes de IA en WhatsApp para mypes" --primary "Entrar al portal"
node <skill>/assets/layout/check.mjs --url dist/index.html --root dist --profile .taste-skill/chrome-check --sizes 1440x900,1024x768,820x1180,768x1024,390x844 --shots .taste-skill/shots/layout
node <skill>/scripts/shoot.mjs --url dist/index.html --root dist --w 1440 --out .taste-skill/shots/1440.png --profile .taste-skill/chrome-shoot
node <skill>/scripts/perf.mjs dist/index.html --root dist --profile .taste-skill/chrome-perf
node <skill>/scripts/gate.mjs dist/index.html
```

Reglas que la página sigue: cada sección mide una o dos pantallas, bordes
iguales a la izquierda y a la derecha, sin textos bajo las imágenes, la entrada
del hero (`data-enter`) y dos momentos repartidos (`iris-opens`,
`word-highlight`). Las excepciones aceptadas del gate van en
`.taste-skill/waivers.json` con su motivo.

## Límites

- La landing no debe importar código, secretos ni bindings del Worker.
- Los chats y el portal del inicio son HTML de demostración; no dependen del
  webhook real ni del portal.
- Un formulario o CTA que requiera persistencia necesita un backend explícito.
  No se debe presentar JavaScript local como si almacenara leads.
- Las afirmaciones comerciales deben diferenciar agentes disponibles y agentes
  próximos. No se inventan clientes, testimonios, cifras ni logos.
- No se descargan fotos, iconos ni fuentes de internet para la landing.
- El build de la landing no debe desplegar ni reiniciar Manolo.

## Desarrollo

Desde la raíz:

```powershell
pnpm install
pnpm dev
pnpm build
pnpm preview
```

No hay pruebas unitarias de la landing; las comprobaciones de taste-skill de la
sección anterior hacen de revisión visual y de accesibilidad.

## Despliegue

El `Dockerfile` raíz construye y sirve la salida estática. La landing también
puede publicarse copiando `dist/` a un servidor estático. Esta entrega es
independiente de `wrangler deploy` y de Docker Compose del bridge.
