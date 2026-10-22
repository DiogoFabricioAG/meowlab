# WhatsApp bursts — release 2026-10-22

Paquete aislado sobre el Worker activo `02e3ea4b-da57-47ba-b73d-4ecb4fe8f849`.
La fuente JavaScript revisada se conserva deliberadamente en esta release:
los cambios locales no publicados de otros agentes no entran en producción.
`release-manifest.json` identifica base, huellas y fronteras modificadas.
RADAR y los demás handlers del paquete activo se conservan.

Publicado en Cloudflare: `bf74500a-59ea-4820-be93-aa3c89adb780`, con agrupación
activada. Réplica GitHub en `/opt/manolo-platform/releases/bursts-git-20261022`.
No se reconstruyeron servicios del VPS. Evidencia y límites de validación en
`docs/operations/bursts-activation-2026-10-22.md` del repositorio.

## Validar y desplegar

Desde este directorio:

```sh
npm ci --ignore-scripts
npm test
npx --yes wrangler@4.151.3 deploy --dry-run --keep-vars
npx --yes wrangler@4.151.3 deploy --keep-vars
```

La versión de Wrangler indicada reconoce `observability.redact_query_string`
de la configuración activa. No aplicar las migraciones D1 de este paquete en
producción: se incluyen sólo como fixtures para pruebas. La única migración
operativa nueva es la clase SQLite DO `whatsapp-bursts-v1`, gestionada por el
despliegue del Worker. No se requiere reconstruir el bridge, FacturaYa o landing.

## Comportamiento

Ventana de 3 s desde el último texto, máximo 10 s/20 textos/8.000 caracteres.
Texto consolidado una vez al rol; botones/media son barreras FIFO separadas.
Originales en D1 y espejo VPS. La emisión exige el botón vigente. Un turno
incierto no se repite y bloquea crear hasta revisión administrativa.

## Administración

`POST /internal/conversations/burst-admin` usa HMAC SHA-256 sobre
`timestamp.body` con el secreto ya compartido con el VPS, ventana de cinco
minutos, ID de petición firmado dentro del cuerpo y contacto/tenant resueltos
desde D1. Body máximo 4 KiB; no devuelve textos, teléfonos ni credenciales.
Acciones `inspect` y `release`. Release exige huella vigente, referencia de
revisión y afirmación explícita de haber comprobado FacturaYa; rechaza cola en
curso, checkpoint cambiado o fase `issuing`. Audita y deduplica la revisión,
invalida botones anteriores y conserva datos comerciales. No emite ni importa.

La herramienta `infra/vps/burst-admin.mjs` del repositorio se ejecuta por SSH
dentro del bridge (lee su Docker Secret sin mostrarlo):

```sh
docker exec -i manolo-platform-bridge-1 node --input-type=module - \
  --tenant TENANT --contact ID --action inspect < infra/vps/burst-admin.mjs
```

Tras comprobar manualmente comprobantes/borradores en FacturaYa, ejecutar con
`--action release --expected HUELLA --review-ref TICKET --verified-facturaya`.
No liberar una emisión pendiente: reconciliar primero su resultado fiscal.
No publicar tokens, payloads o códigos de clientes en el ticket.

## Rollback

No desactivar la bandera con pendientes: las alarmas existentes continuarían
procesando mientras el ingreso inmediato vuelve a ejecutarse. Acordar una
ventana de mantenimiento, drenar/reconciliar y después desactivar/publicar
versión anterior. Conservar clase DO, migración y storage; nunca restaurar toda
la base D1 encima de conversaciones nuevas para revertir esta función.
