# Documentación de MeowLab

Este directorio describe el repositorio completo. Los runbooks específicos que
ya viven dentro de una aplicación se mantienen allí y se enlazan desde aquí
para evitar dos versiones de la misma instrucción.

## Mapa documental

```text
docs/
├─ README.md
├─ project/
│  ├─ status.md
│  └─ repository-map.md
├─ architecture/
│  └─ current-system.md
├─ apps/
│  ├─ landing.md
│  └─ manolo-platform.md
├─ development/
│  └─ validation.md
├─ operations/
│  └─ deployment.md
├─ agents/
│  └─ orchestration.md
└─ decisions/
   └─ README.md
```

## Cómo navegar

- Estado real y pendientes: [`project/status.md`](project/status.md).
- Ubicación y responsabilidad de cada carpeta:
  [`project/repository-map.md`](project/repository-map.md).
- Flujo actual Cloudflare ↔ VPS:
  [`architecture/current-system.md`](architecture/current-system.md).
- Landing Astro: [`apps/landing.md`](apps/landing.md).
- Worker y plataforma Manolo:
  [`apps/manolo-platform.md`](apps/manolo-platform.md).
- Matriz de pruebas: [`development/validation.md`](development/validation.md).
- Despliegues y rollback: [`operations/deployment.md`](operations/deployment.md).
- División segura de trabajo entre agentes:
  [`agents/orchestration.md`](agents/orchestration.md).
- Decisiones arquitectónicas: [`decisions/README.md`](decisions/README.md).

Los agentes deben iniciar en [`../AGENTS.md`](../AGENTS.md), que funciona como
router según el tipo de tarea.

## Documentación local existente

La aplicación Manolo conserva documentos canónicos de detalle:

- [`apps/manolo-whatsapp-worker/README.md`](../apps/manolo-whatsapp-worker/README.md):
  roles, variables, flujos y comandos del Worker.
- [`architecture-foundation.md`](../apps/manolo-whatsapp-worker/docs/architecture-foundation.md):
  arquitectura objetivo y plan para retirar D1.
- [`infra/vps/README.md`](../apps/manolo-whatsapp-worker/infra/vps/README.md):
  operación segura del bridge y PostgreSQL.
- [`docs/vps-migration/`](../apps/manolo-whatsapp-worker/docs/vps-migration/):
  inventarios, respaldos y reportes fechados de despliegue.

## Convenciones

- Los documentos de estado llevan fecha de corte.
- Los reportes históricos no se editan para representar el presente.
- Una nueva decisión estructural se registra como ADR.
- No se copian secretos, teléfonos completos, tokens, cadenas de conexión ni
  contenido privado de conversaciones.
- Los enlaces internos son relativos para que funcionen en GitHub y localmente.

