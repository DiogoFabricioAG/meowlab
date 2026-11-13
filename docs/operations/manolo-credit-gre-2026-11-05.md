# Manolo: crédito y GRE publicados — 2026-11-05 Lima / 2026-11-06 UTC

Publicación autorizada por Diogo y coordinada con el mantenedor de FacturaYa.
Se esperó su señal de backend listo antes de escribir en el VPS o publicar
Manolo. No se emitieron documentos reales ni se modificaron credenciales GRE,
correlativos, configuración fiscal, contactos, membresías o roles asignados.

## Entrega activa

- Worker `4ceeaa93-b19e-41b5-b864-bdeb046a2f42` al 100 %, sobre
  `158b52bc-e20a-4a8f-ae31-92e64f3fdbef`.
- Bridge `manolo-platform-bridge:fiscal-20261105`, también `latest`, imagen
  `sha256:84ee1c657f154b4e2f4aeda4c7797eff7db9d7036162c6964c6a429995d562f8`.
- Crédito: condición explícita, saldo/cuotas, validación decimal, resumen y botón.
- GRE: categoría M1/L/otra primero, factura elegida, borrador inmutable, revisión
  completa y digest, consulta de ticket sin reenvío. M1/L omite vehículo/conductor.
- La guardia de ráfagas bloquea también `enterprise_gre_confirm:` cuando un turno
  anterior queda incierto. No cambia agrupación, alarmas ni recuperación existentes.

**GRE fiscal real sigue deshabilitada en FacturaYa.** Publicar el flujo no habilita
emisión real: requiere configuración administrativa y validaciones pendientes.
Precarga de bienes total/parcial, PDF/QR y entrega XML/CDR por WhatsApp siguen fuera
de esta entrega. Archivos sólo mediante integración autenticada; no hay portal GRE.

## Aislamiento y preservación

Los generadores `tools/snapshot-fiscal-release.mjs` y
`tools/prepare-fiscal-release.mjs`, relativos al paquete Manolo, guardan snapshots
privados y construyen desde el runtime activo. No se reconstruyó el entrypoint
del árbol sucio. La comprobación inversa recupera los bytes previos al patch:

- Worker: dos constructores (rol empresarial/cliente VPS) y una condición de
  bloqueo de creación. El nuevo dominio se importa como módulo independiente.
- Bridge: constructor del servicio FacturaYa y llamada a su validador. Preserva
  el wrapper RADAR y el resto del bundle, módulos e imagen original.
- El adaptador D1 anterior y el módulo nuevo pueden tener clases de error
  distintas; se reconoce el contrato estrecho de fallo de almacenamiento sin
  convertirlo en conflicto ni reintentar efectos. Dos regresiones lo cubren.

Tras publicación se compararon bindings, nombres de secretos, variables,
compatibilidad, observabilidad, cron `*/15 * * * *` y ráfagas `true` contra el
snapshot vivo. La imagen conserva entorno, redes, montajes de secretos, memoria,
capabilities y filesystem de sólo lectura. Sin nuevas migraciones Manolo,
puertos públicos, rutas Meta, DNS, Caddy, dependencias ni reconstrucción de RADAR.

## Respaldo y comprobaciones

Artefactos privados locales bajo
`apps/manolo-whatsapp-worker/backups/fiscal-20261105/` (ignorados por Git):
snapshots antes/después, manifiesto con hashes, paquete aislado, imagen fuente,
logs y export D1. Nunca copiar dumps o archivos con credenciales al repositorio.

- Export D1: 624447 bytes, SHA-256
  `dbb87a7d529d1f05236dd2531059d69ee00f2e08efa4cadb5f5d3ae8e8fe06f0`.
  Recuperado del export ya creado tras fallar su descarga a una ruta local;
  restauración independiente SQLite: 26 tablas, `integrity_check=ok`.
  La importación mediante Wrangler local no se completó; no se alteró D1 remoto
  al intentar restaurar. No hubo migración ni corte de autoridad de D1.
- PostgreSQL: dump custom de 527066 bytes en release privada VPS, restaurado con
  `pg_restore --exit-on-error` en contenedor sin red y almacenamiento temporal:
  37 tablas de `whatsapp`/`print_system`. Contenedor retirado después de validar.
- Imagen anterior conservada como `manolo-platform-bridge:before-fiscal-20261105`
  y exportada en `bridge-image.before.tar` dentro de la release privada.
- Paquete VPS: SHA-256
  `0af20224252f1a711c5afcb73da0dcafc88c33e599049fa25e3676a825506d39`,
  comprobado después de SCP.
- 282 pruebas del paquete aislado, 17 archivos, incluidas regresiones RADAR,
  crédito, GRE, categorías, HMAC/replay y ráfagas; todas correctas. Sólo las pruebas
  RADAR fijan su reloj dentro del horario, sin modificar el runtime publicado.
- Typecheck correcto, 19 pruebas locales de ráfagas y deploy en seco con Wrangler
  4.157.0. El árbol principal conserva los dos fallos RADAR conocidos por reloj real.
- Staging sin ingreso público; salud, ruta RADAR y HMAC/permisos/replay correctos.
  Tras recrear únicamente `bridge`, el mismo smoke pasó por Caddy público.
  Cinco operaciones con contacto sintético inexistente fueron rechazadas y sus
  replays verificados: cero consultas de identidad/proveedores o emisión fiscal.
- Worker salud 200 y contenido descargado igual **byte por byte** al artefacto
  del dry-run: SHA-256
  `a87c233b6ac9431b4acfd73cd42d019cf12049f67e7bf9e804e341af28b61625`.
- FacturaYa `/up` 200 y `/api/despatches` sin token 401; no se creó una guía real
  para probar disponibilidad. El staging Manolo se retiró al cerrar.

## Operación y rollback

Release VPS: `/opt/manolo-platform/releases/fiscal-20261105`, privada.
Compose/secrets vigentes: `/opt/manolo-platform/infra/vps`, preservados.
No reconstruir desde el árbol anterior con `up --build`.

Volver al Worker anterior con Wrangler 4.157.0 desde una configuración validada:

```sh
npx wrangler@4.157.0 rollback 158b52bc-e20a-4a8f-ae31-92e64f3fdbef
```

Revertir sólo el bridge, sin borrar PostgreSQL, desde el VPS:

```sh
python3 /opt/manolo-platform/releases/fiscal-20261105/deploy-fiscal-release.py rollback
```

El script retaggea la imagen anterior y recrea exclusivamente `bridge` con el
Compose existente; comprueba salud. Conserva bases, secretos, redes y demás
servicios. Repetir smoke de contrato compatible y salud, sin usar usuarios reales
ni emisiones. No deshacer el backend FacturaYa o su migración desde este runbook:
su entrega la administra su mantenedor por separado.

La autorización de esta entrega no implica publicar futuros cambios. Para otra
release, inventariar nuevamente la base activa y preparar un paquete distinto;
el generador actual rechaza una versión que no coincida con su base fijada.
