# Fichas de agentes, Inicio del día y arreglos de la crítica de diseño

Fecha: 13/11/2026 (16:19–16:30 UTC). Pedido y autorizado por el operador («Sí, despliégala»),
después de la crítica con el método impeccable (22/40 en heurísticas de Nielsen).

## Qué se desplegó

| Parte | Commit publicado | Despliegue |
| --- | --- | --- |
| Bridge | `20dcc2166fbaac38b8ccfb9f6140f79c2cc68b4a` (`feat/portal-agentes`) | release `/opt/manolo-platform/releases/portal-agentes-20261113T161923Z` |
| Portal | `b087f59e78d48c89ba3d2bee8999dddaeb87e39e` (`feat/portal-agentes-app`) | imagen `meowlab-app:b087f59e78d4` (antes `meowlab-app:57263d3b6e93`) |

Sin migraciones, sin cambios en FacturaYa ni en el compose del bridge.

- Bridge: el resumen `weekly` suma el día en curso en Lima (comprobantes y facturado de
  hoy, licitaciones de hoy, mensajes del equipo hoy) y `tender.enabled` (alguien de la
  empresa tiene Tender Cat en el chat de Manolo).
- Portal, pensado para la titular de una MYPE con todos los agentes en el chat de Manolo:
  Inicio con el día en frases, «Tus agentes» con una ficha por agente (activo, falta un
  paso, disponible, próximamente), rutas propias por sección, Invoice Cat atado a la
  empresa elegida (P0 de la crítica), tarjetas de comprobantes en el celular con el
  motivo del rechazo visible, Plan sin callejón sin salida, acciones destructivas en
  rojo con confirmación, textos sin género y arreglos de accesibilidad (h1 por página,
  `inert` en el acceso, saltar al contenido, foco y placeholders legibles).

## Verificación

- Bridge: `healthy`; consulta firmada de prueba igual que en la release anterior
  (`weekly` de una empresa ajena `forbidden`); conteos 1750 · 258 · 728.
- Semana real de CREACIONES J&D desde la cuenta administradora (sólo conteos): hoy 1
  mensaje del equipo, 7 licitaciones nuevas, Tender Cat habilitado, 0 comprobantes hoy.
- Portal: `healthy`; `/`, `/inicio`, `/agentes`, `/agentes/facturas`,
  `/agentes/licitaciones`, `/plan` y `/ajustes/equipo` 200; `/api/me` y `weekly` sin
  sesión 401; sin errores en el log.

## Rollback

```bash
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=57263d3b6e93 docker compose up -d
bash /opt/manolo-platform/releases/portal-agentes-20261113T161923Z/rollback.sh
```
