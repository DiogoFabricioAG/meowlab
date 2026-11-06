# Recordatorio RADAR previo al cierre — 2026-11-04

## Estado

**Activo con autorización explícita del usuario**. La versión de producción es
`d1ab0df4-5a89-4b1b-8032-4ab4f92cd6f8` (100 %), sobre
`35d4c8bb-27a6-4cb7-a704-f5092f0a3834`. El paquete privado
preparado está en
`apps/manolo-whatsapp-worker/backups/radar-window-reminder-20261104/release`.
No contiene ni modifica valores de secretos; conserva los demás handlers y roles.

Activación verificada el 2026-11-04 19:30 UTC: respaldo privado de D1 restaurado
en SQLite desechable, migración `0018` probada sobre ese respaldo y aplicada
exclusivamente con su registro en `d1_migrations`. No se aplicó la migración
histórica pendiente `0013` ni ninguna otra. Snapshot previo y posterior,
bindings, nombres de secretos y compatibilidad coinciden. Cron publicado,
salud HTTP 200 y petición sin token rechazada con 401. Evidencia privada en
`backups/radar-window-reminder-20261104/activation-verification.json`.

Se confirmó mediante API la preferencia de la instalación local que ya tenía
alertas activas en SQLite; su ventana estaba abierta. Sin inscripción masiva ni
envío manual a Meta. La sincronización continua de pausa necesita abrir el
escritorio actualizado: no se reinició el proceso existente ni se publicó
instalador. La baja por WhatsApp conserva efecto inmediato en servidor.

## Contrato

El Worker incorpora `src/radar/window-reminder.ts` mediante
`withRadarWindowReminders` en el export principal. La única interceptación HTTP
es `POST /v1/projects/radar/reminders`, Bearer de instalación y cuerpo exclusivo
`{enabled:boolean}`. Guarda en D1 la preferencia de esa instalación. No acepta
números arbitrarios ni introduce otro webhook. El escritorio RADAR sincroniza
su activación/pausa y reintenta una pausa offline al reconectar.

Cron `*/15 * * * *`, reloj de pared UTC con horario 08–20 Perú. Normalmente se
avisa dos horas antes de vencer; si el cierre nocturno no deja un intervalo
diurno con margen, se adelanta a las 19:45 anteriores. Se conserva un margen de
quince minutos antes del cierre; con falta de autorización/red o pacing puede
no existir un intento permitido. No se envía después del vencimiento ni se
renueva la ventana mediante envíos.

La migración aditiva `0018_radar_window_reminders.sql` crea preferencias (ausencia
equivale a desactivado) e índice del ledger. No cambia consentimientos existentes.
El cron exige servicio activo, consentimiento, preferencia, ventana vigente y
rol RADAR mediante la resolución firmada existente del VPS. Si falla esa consulta,
no se usa el rol D1 como respaldo en producción. En modo local sin VPS se consulta
el rol D1 de un contacto existente y canal/tenant activos.

Reserva atómica en `radar_deliveries`: una por ventana y una por día/destinatario,
incluidas múltiples instalaciones y crons concurrentes. Comparte la separación
de treinta minutos con oportunidades. Se revalida consentimiento, preferencia,
ventana y horario antes de Meta. Los estados `sending/unknown/accepted` evitan
reenvío ambiguo; tampoco se reintenta un rechazo para la misma ventana. Las
confirmaciones de entrega siguen el webhook existente; aceptación no es entrega.
El recordatorio no crea `radar_alert_context`, por lo que no sustituye la última
oportunidad para los seguimientos.

El botón «Seguir recibiendo» se procesa con `consumeRadarReminderReplies` sólo
después de validar la firma Meta y de `radarVerifiedWebhook`. La ventana la
actualiza ese mensaje entrante auténtico. La confirmación se deduplica contra
`radar_inbound` y el delivery propio, con autorización de rol; no cambia roles,
no reactiva la pausa y no cae en FacturaYa. `RADAR BAJA` sigue revocando el vínculo.

## Entrega aislada, previa autorización

`tools/prepare-radar-reminder-release.mjs` verifica la versión del snapshot, las
variables y bindings; aplica tres sustituciones únicas y prueba su reversibilidad.
La base es el bundle realmente desplegado, no `src/index.ts` con trabajo ajeno.
El módulo nuevo se compila por separado. Los fuentes de la entrega anterior se
copian sólo como soporte de pruebas; las rutas productivas permanecen en el bundle.
El manifiesto conserva SHA-256 y nombres de secretos, sin valores.

Antes de publicar:

1. Volver a consultar versión, configuración y schedules, y comparar con el
   snapshot revisado. Si cambió la base, detener y preparar otra composición.
2. Respaldar D1 de forma privada. Confirmar que producción tiene migraciones
   hasta `0017`; aplicar exclusivamente `0018` tras revisar el historial.
   No aplicar todas las migraciones del árbol con trabajo ajeno.
3. Repetir dry-run con Wrangler actual compatible con `observability` existente.
4. Desplegar exclusivamente el paquete aislado y verificar cron, bindings,
   salud y preferencia autenticada sin disparar un envío de prueba al cliente.
5. Usar un escritorio actualizado. La ausencia de una preferencia confirmada
   no habilita instalaciones previas por defecto. Separar el instalador público.

Rollback: restaurar la versión y schedules previos (snapshot: ninguno). La tabla
aditiva puede permanecer sin consumidores; no borrar consentimientos ni ledger.
No modificar VPS, DNS, callback Meta o reglas de red.

## Evidencia local

15 pruebas nuevas cubren vencimientos/horarios, firmas, duplicados, aislamiento,
rol, errores y actualización de D1 desde el esquema anterior. Suite completa del
Worker, typecheck, `wrangler types --check`, paquete aislado y deploy en seco;
los resultados finales se registran en el tablero. Ninguna prueba envía a Meta:
el transporte se sustituye y utiliza destinatarios sintéticos.
