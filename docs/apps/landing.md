# Landing MeowLab

## Propósito

La aplicación raíz es la presencia comercial de MeowLab (meowlab.tech). Presenta
los agentes ("gatos") que trabajan dentro del mismo chat de WhatsApp con MeowLab y
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
| `/precios` | `src/pages/precios.astro` con `src/layouts/LandingLayout.astro` |
| `/contacto` | `src/pages/contacto.astro` |
| `/privacidad` | `src/pages/privacidad.astro` (datos en `src/data/legal.ts`) |
| `/terminos` | `src/pages/terminos.astro` (datos en `src/data/legal.ts`) |

Las páginas internas usan `src/layouts/Layout.astro` con `Navbar.astro` y
`Footer.astro`, que repiten la navegación y las columnas del inicio. Las legales
usan `src/components/LegalPage.astro`.

## Inicio (rediseño 2026-11-16 sobre el kit taste-skill)

Tipo de página: software (`data-type`, `page-type` y `site-kind` = software).
Acción principal: «Entrar al portal» → `https://app.meowlab.tech` (en la barra,
el hero y el cierre).

| Sección | Contenido | Visual |
| --- | --- | --- |
| hero (`split`) | h1 «Agentes de IA en WhatsApp para mypes peruanas», qué hace MeowLab en una línea, «Entrar al portal» y «Conoce a los gatos» | celular con WhatsApp en HTML: el visitante toca «Emitir» o «Corregir» y la conversación sigue |
| `#gatos` | qué es un gato y los siete, uno por paso; cada paso tiene una pestaña por actor con el que trabaja el gato (cliente, dueño, proveedor) y su tipo de participación, según [`project/matriz-participacion.md`](../project/matriz-participacion.md) | recorrido con scroll: el paso del centro elige el gato y su pestaña elige la conversación del celular fijo; sin tocar, las pestañas avanzan solas al terminar cada conversación; bajo las pestañas aparecen las tarjetas de lo que pasa entre gatos; fila de logos para saltar a un gato |
| `#juntos` | los gatos trabajan juntos: una clienta escribe de noche, Support Cat le pide la cotización a Sales Cat, que revisa el stock con Stock Cat, y lo que no sabe se lo pregunta al dueño | chat de la clienta y, al lado, las tarjetas «de quién a quién» que aparecen al ritmo del chat; «Ver de nuevo» |
| `#panel` | qué ves en el panel | el Inicio del portal como lo dibuja `apps/meowlab-app` (barra lateral, «Hola, Rosa», una línea por gato y «Para atender»), sin barra de URL |
| `#preguntas` | cinco preguntas en acordeón (`details`), con enlace a `/precios` | — |
| pie (`footer.closing`) | bloque verde «Empieza con un gato y suma los que necesites» con «Entrar al portal» y «Ver los precios», y columnas | los siete logos |

Los precios viven en `/precios` (`src/pages/precios.astro`): la lista de los siete
gatos con su precio mensual con IGV y el plan de ejemplo con los descuentos del
portal (10 % por 2, 15 % por 3 o 4, 20 % por 5 o más; `migrations-postgres/0003_billing.sql`).

Las conversaciones están en `src/components/landing/chats.ts`, una por gato y actor
(`invoice-dueno`, `sales-cliente`, …). Las pestañas siguen la matriz de
participación. Una pestaña cuya conversación aún no existe en producción lleva la
etiqueta «Próximamente» y una línea con lo que el gato hace hoy; es decisión del
operador del 2026-11-16. Hoy son: Sales con el cliente y con el dueño, Invoice con
el cliente, Stock consultado al cotizar, Collections con el cliente y la parte
proactiva de Support con el cliente. Cuando una de ellas llegue a producción, se
quita su `soon` en `src/pages/index.astro`.

Las capturas de Yape de los chats usan la imagen de la demo
(`public/assets/landing/yape-captura.webp`: datos de ejemplo, María Fernanda C.,
S/ 250, operación 41756321). La factura del proveedor sigue dibujada en HTML. `src/scripts/chat.ts` las reproduce en `Phone.astro`; con
movimiento reducido los mensajes aparecen sin animación y los botones siguen
respondiendo. Fuera de los celulares la página usa tres colores: blanco, tinta y
el verde de la marca (con el menta como su tono claro); dentro, la paleta de
WhatsApp.

Componentes en `src/components/landing/` (`LandingNav`, `LandingFooter`, `Phone`,
`chats.ts`). CSS: `src/styles/home.css` (inicio) y `src/styles/landing.css`
(barra, pie y `/precios`). Las ilustraciones derivadas de los gatos de la marca
están en `public/assets/landing/` y los logos de los gatos en
`public/assets/agents/`.

En la landing el chat se llama «MeowLab» (antes «Manolo»), como en la presentación
del 2026-11-16; el Worker y la documentación técnica conservan el nombre Manolo.

Hechos que la página puede afirmar (actualizado el 2026-11-15; fuente: ADR-0011,
0013, 0014, 0015, 0016 y 0017):

- Funcionan los siete gatos y cada uno tiene su página en app.meowlab.tech. Todos
  trabajan en el mismo chat de MeowLab, salvo Support Cat, que atiende a los
  clientes de la empresa en el WhatsApp de la propia empresa.
- Invoice Cat: facturas, boletas, notas de crédito y guías de remisión ante SUNAT
  desde el chat, con FacturaYa.
- Tender Cat: licitaciones del SEACE que encajan con el negocio.
- Sales Cat (`/sales`): registra ventas al contado o al crédito y arma
  cotizaciones que se comparten con un enlace y en PDF.
- Stock Cat (`/stock`): inventario; entradas por chat o con la foto de la factura
  del proveedor; salidas automáticas con los comprobantes; avisos de stock mínimo;
  conteos.
- Collections Cat (`/collections`): lleva lo que le deben a la empresa (ventas a
  crédito, facturas a crédito, lo dicho en el chat), acepta pagos parciales, las
  capturas de pago las valida una persona, prepara recordatorios en tres tonos que
  hoy el equipo envía con un botón y avisa qué clientes necesitan que les hable la
  titular.
- Reorder Cat (`/reorder`): cuando algo baja del mínimo propone el pedido, la
  titular aprueba, el gato le escribe al proveedor por WhatsApp a nombre del
  negocio, insiste a las 24 horas, avisa si no logra cerrar, arma la orden de
  compra en PDF y, para productos propios, la orden de producción.
- Support Cat: postventa 24/7 en el WhatsApp de la empresa; responde las preguntas
  frecuentes que carga la titular y el estado de cotizaciones y ventas, cotiza con
  el catálogo de Sales Cat, pasa a la titular lo que no sabe y los reclamos,
  pregunta «¿te ayudé?» y manda un resumen diario.

La página no promete lo que es de fases posteriores: recordatorios de cobro
enviados solos desde el número de la empresa, cargas por Excel, cuentas por pagar
ni metas de venta.

Precios mensuales con IGV: Invoice S/ 39, Sales S/ 59, Stock S/ 29, Reorder
S/ 25, Support S/ 39, Collections S/ 25, Tender S/ 35. Descuentos: 2 agentes
10 %, 3–4 agentes 15 %, 5–6 agentes 20 %. Los nombres, montos y series que
aparecen dentro de los chats y del portal son datos de demostración de la
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
