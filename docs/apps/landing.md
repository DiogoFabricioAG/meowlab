# Landing MeowLab

## Propósito

La aplicación raíz es la presencia comercial de MeowLab. Presenta los agentes,
servicios dedicados y micro-SaaS; no procesa webhooks ni comparte runtime con
Manolo.

## Stack y rutas

- Astro 5.
- Tailwind CSS 3.
- Salida estática por directorio.
- View Transitions mediante `ClientRouter`.
- Tipografías locales Blinker y Actor.

| URL | Archivo |
| --- | --- |
| `/` | `src/pages/index.astro` |
| `/agentes` | `src/pages/agentes.astro` |
| `/contacto` | `src/pages/contacto.astro` |
| `/dedicado` | `src/pages/dedicado.astro` |
| `/servicios` | `src/pages/servicios.astro` |

`src/layouts/Layout.astro` compone navegación, footer, metadatos y estilos. Las
secciones reutilizables viven en `src/components/`; los recursos de marca y las
fuentes viven en `public/`.

## Límites

- La landing no debe importar código, secretos ni bindings del Worker.
- La simulación de WhatsApp es demostrativa; no es una dependencia del webhook
  real.
- Un formulario o CTA que requiera persistencia necesita un backend explícito.
  No se debe presentar JavaScript local como si almacenara leads.
- Las afirmaciones comerciales deben diferenciar servicios actuales, pilotos y
  conceptos futuros.
- El build de la landing no debe desplegar ni reiniciar Manolo.

## Desarrollo

Desde la raíz:

```powershell
pnpm install
pnpm dev
pnpm build
pnpm preview
```

No hay pruebas ni lint de la landing en el estado actual. Cualquier cambio de
interfaz debe, como mínimo, compilar y revisarse visualmente en escritorio y
móvil.

## Despliegue

El `Dockerfile` raíz construye y sirve la salida estática. La landing también
puede publicarse copiando `dist/` a un servidor estático. Esta entrega es
independiente de `wrangler deploy` y de Docker Compose del bridge.

