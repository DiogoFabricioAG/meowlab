# Mapa del repositorio

## Vista general

```text
meowlab/
├─ AGENTS.md                         # Router de trabajo para agentes
├─ docs/                             # Documentación transversal
├─ src/                              # Landing Astro
├─ public/                           # Marca, fuentes e imágenes públicas
├─ package.json                      # Ciclo de la landing
└─ apps/
   └─ manolo-whatsapp-worker/
      ├─ src/                        # Worker, roles, adaptadores y bridge Node
      ├─ test/                       # Pruebas Vitest del runtime
      ├─ migrations/                 # Evolución D1
      ├─ infra/postgres/             # Esquema y migraciones PostgreSQL
      ├─ infra/vps/                  # Docker, Caddy, scripts y smoke tests
      ├─ tools/                      # TUI, respaldos y verificaciones
      ├─ docs/                       # Arquitectura y evidencia de migración
      ├─ wrangler.jsonc              # Bindings y variables del Worker
      └─ package.json                # Ciclo independiente de Manolo
```

## Landing

| Ruta | Responsabilidad |
| --- | --- |
| `src/pages/` | Rutas estáticas de Astro |
| `src/layouts/Layout.astro` | HTML base, SEO, navegación común y transiciones |
| `src/components/` | Secciones visuales y simulador de WhatsApp |
| `src/styles/global.css` | Tokens y estilos globales |
| `public/` | Logos, favicon y tipografías Blinker/Actor |
| `astro.config.mjs` | Salida estática con formato por directorio |
| `tailwind.config.mjs` | Tema visual de MeowLab |

## Manolo

### Entrada y composición

- `src/index.ts`: endpoint del Worker, validación de firma, deduplicación,
  normalización multimodal, composición de adaptadores y despacho por rol.
- `src/node/server.ts`: servidor HTTP del bridge VPS.
- `src/roles/registry.ts`: catálogo de handlers disponibles en runtime.
- `src/roles/contracts.ts`: contexto que reciben los roles.

### Dominios

| Directorio | Dominio |
| --- | --- |
| `src/roles/` | Comportamiento conversacional por rol |
| `src/ai/`, `src/audio/`, `src/image/` | Contratos y contexto multimodal |
| `src/whatsapp/` | Contratos de mensajes y acciones interactivas |
| `src/conversations/` | Persistencia e historial conversacional |
| `src/quotes/` | Extracción, numeración, HTML y montos de cotización |
| `src/business/` | Consultas analíticas de solo lectura |
| `src/facturaya/` | Contratos Worker ↔ VPS para comprobantes |
| `src/store-designer/`, `src/store-commerce/` | Contratos de diseño, catálogo y pedido |
| `src/documents/` | Retención temporal de documentos |
| `src/bridge/` | Contratos y firma del enlace Worker ↔ VPS |

### Adaptadores

`src/adapters/` contiene las implementaciones concretas. La dirección esperada
es rol → contrato → adaptador; nunca rol → API externa directamente.

- `ai/`: Groq y endpoint compatible con OpenAI.
- `whatsapp/`: Meta Graph API.
- `conversations/`, `roles/`, `quotes/`: persistencia D1.
- `print-system/`: D1/PostgreSQL de impresión.
- `facturaya/`: API de FacturaYa a través del bridge.
- `store-designer/`: API privada de tienda.
- `documents/`: R2.
- `bridge/`: cliente HMAC del VPS.

### Persistencia y operación

- `migrations/0001` a `0012`: modelo D1 histórico y vigente.
- `infra/postgres/init/`: creación de una base PostgreSQL vacía.
- `infra/postgres/migrations/003` a `006`: evolución de una instalación VPS
  existente. No hay archivos `001` o `002` en esta carpeta porque esas bases se
  originan en los scripts de `init/`.
- `infra/vps/`: Compose del bridge, redes, Docker Secrets, Caddy y smoke tests.
- `tools/users-tui-vps.mjs`: administración actual contra PostgreSQL por SSH.
- `tools/users-tui.mjs`: compatibilidad temporal con grupos de cotizaciones D1.

## Límites de otros repositorios

Este monorepo contiene clientes y contratos, no las implementaciones completas
de los siguientes sistemas:

- FacturaYa vive en su propio servicio del VPS.
- Print System sigue siendo un sistema externo; Manolo replica o consulta su
  información de forma controlada.
- Tienda virtual permanece en un repositorio y despliegue separados.

Los cambios de contrato entre repositorios deben ser compatibles hacia atrás o
coordinarse como una entrega de varias aplicaciones.
