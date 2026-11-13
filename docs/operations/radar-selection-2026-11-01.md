# Activación RADAR: selección durable — 2026-11-01

Alcance solicitado por el propietario: búsqueda en su laptop, API autenticada y
cola en MeowLab para decisiones WhatsApp con el escritorio apagado. Implementación
delegada a tres agentes Luna, integración y revisión a cargo del agente raíz.

## Entrega

- PostgreSQL: sólo `009-radar-selections.sql`, aditiva y transaccional. Respaldo
  completo previo guardado con permisos 0600 bajo la release privada del VPS.
- Bridge: `manolo-platform-bridge:radar-selection-20261101`; base conservada como
  `manolo-platform-bridge:radar-before-20261101`. El bundle original tiene SHA-256
  `8ead020ca0566d252b6b523aa32079c8acfb6795d1000686acbd82775453e14f`.
- El patch cambia un único punto de composición para envolver el handler previo;
  su reversión recupera exactamente el bundle original. La extensión agrega sólo
  `/v1/roles/radar/sync`; todas las demás rutas delegan al handler anterior.
- Staging no se conectó a la red de ingreso público. Salud, rechazo de firma
  ausente y rechazo de scope sintético firmado correctos antes y después del corte.
- Compose/secrets y redes originales preservados; sin DNS, Caddy, puertos públicos
  ni cambios en otros servicios. El bridge se recreó con la imagen probada.
- Worker final `45b386f5-2a61-43c5-9c00-f44264bf9548`, sobre selección inicial
  `aed8e907`; compatibilidad publicada mediante un solo punto de composición HTTP.
  Bindings/variables comparados con snapshots; sin migración D1 ni rotación de claves.

## Evidencia

263 tests del paquete principal; 53 del paquete Worker aislado; typecheck y
Wrangler 4.156.0 dry-run correctos. PostgreSQL real validado en contenedor y DB
`radar_test` separados de producción: selección/idempotencia, scope y permisos,
cursores independientes, 111 eventos paginados, concurrencia y rollback.

Una instalación real publicó el snapshot público de Warmi Ñan y leyó `/sync`
correctamente. No se marcó interés/descarte por el usuario ni se mandaron mensajes
de prueba. La nueva selección humana y el cliente actualizado quedan por observar.
El build local del escritorio pasó 58 pruebas y typecheck; no publica un instalador.
La UI conserva Guardadas, con simplificación y refresco vivo pendientes de la
edición visual paralela. No se editaron los archivos de entrada WebView.

## Rollback

Revertir Worker a `8f97ac89-92af-445c-be19-fb1c6f37484b` deshabilita las nuevas
operaciones sin eliminar decisiones guardadas. Para el bridge, reetiquetar la
imagen `radar-before-20261101` como `latest` y recrear sólo `bridge` desde el Compose
existente. Conservar PG 009, sus decisiones y el respaldo; no borrar cursores,
selecciones o deduplicación. El handler antiguo ignora las tablas nuevas.

Artefactos privados locales: `backups/radar-selection-20261101/`; release VPS:
`/opt/manolo-platform/releases/radar-selection-20261101`. Los dumps no se agregan
a Git ni al instalador. Generadores revisables bajo `tools/prepare-radar-selection*`.
