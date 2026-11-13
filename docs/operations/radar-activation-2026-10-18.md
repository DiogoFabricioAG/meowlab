# Activación del servicio RADAR — 2026-10-18

- Autorización: confirmación explícita del fundador para aplicar D1 0014 y
  desplegar/activar RADAR en el Worker existente.
- Servicio: `whatsapp-webhook-meta-production`.
- Versión publicada: `02e3ea4b-da57-47ba-b73d-4ecb4fe8f849`.
- Versión anterior/rollback: `c8ac096f-87a1-4c53-a875-719feeabd76d`.
- Estado: publicado y habilitado; vinculación de usuario/envío real e instalador
  público actualizado pendientes.

## Preparación y alcance

Se comprobó el despliegue activo y se descargó su código/configuración con
Wrangler a un directorio privado de respaldo ignorado por Git. La fuente activa
tenía SHA-256 `a620ec59b9b3094699d0f095076d6330b17b1b24308c269406919ab1fa27c201`.

Como el árbol local de MeowLab conserva cambios ajenos, se preparó la publicación
sobre esa fuente activa mediante `tools/prepare-radar-release.mjs`, agregando
únicamente imports RADAR, despacho de su API y procesamiento posterior a la firma
de Meta/anterior al flujo de roles. La verificación inversa reconstruyó exactamente
la fuente previa. Se preservó la configuración descargada y se usó `--keep-vars`.
No se publicaron otros cambios locales de Manolo ni la landing o el bridge VPS.

El paquete resultante pasó las 14 pruebas RADAR, incluido el recorrido
registro→vínculo firmado→alerta→baja, usando D1 local y Meta simulado. Se ejecutó
el dry-run con Wrangler 4.151.1 para conservar el campo de observabilidad
`redact_query_string`, no reconocido por la versión 4.113.0 del proyecto. No se
actualizaron package.json/lockfiles para esta operación.

## D1 y respaldo

Se exportó exclusivamente la base WhatsApp afectada. El respaldo de 433185 bytes,
SHA-256 `b9404d9cb11a64bc16ac5ba32620624b82e55ea4f92f43cb942bcad5ae5235a2`,
se restauró en SQLite en memoria y pasó `integrity_check` y `foreign_key_check`.
Los datos y artefactos privados permanecen fuera de Git, bajo ACL del usuario
operador; no se copian aquí conversaciones, teléfonos, tokens ni enlaces de
descarga firmados.

La base tenía migraciones hasta 0012. Se aplicó únicamente
`0014_radar_notifications.sql` y se añadió su entrada al ledger. Se comprobó
que 0013, relativa a otro cambio de roles, sigue sin aplicar. Las seis tablas
RADAR se crearon con `enabled=0`.

Después del despliegue se verificaron `/health` 200 y API RADAR 503 mientras
seguía desactivada. Se configuró el ID del único canal activo existente y el
número público confirmado por el fundador, y se activó la fila de ajustes.

## Comprobaciones de producción

`tools/smoke-radar-live.mjs` ejecutó por HTTPS:

- salud 200;
- webhook sin firma 401;
- API sin autorización 401;
- registro de una instalación de prueba 201, con enlace de vinculación;
- estado sin vincular: `linked=false`, `open=false`;
- alerta de fixture marcada como prueba y sin vinculación: 403 `not_linked`;
- baja de la instalación de prueba confirmada;
- token revocado rechazado con 401.

El token y el código temporal no se imprimieron ni conservaron en el reporte.
La instalación de prueba quedó revocada. Se comprobó que `radar_deliveries`
continuaba vacío: no se enviaron alertas reales. No se simuló una firma de Meta
en producción ni se abrió artificialmente una ventana.

Las huellas de asignación de roles de contactos, roles de bots y números activos
coinciden con el respaldo. Los bindings de la nueva versión coinciden con los
de la anterior, incluidos los secretos por nombre/tipo; no se leyeron valores
de secretos. No se cambiaron callback Meta, DNS, dominios, redes o VPS.

## Uso y pendientes

Abrir la versión actualizada de RADAR y pedir «vincula mi WhatsApp». El usuario
debe enviar el código desde su celular al número compartido para autorizar
alertas. El horario inicial es 09:00 America/Lima. No se acredita todavía el
recorrido real de vinculación/entrega ni la atención fiscal mediante una
operación real; el aislamiento se verificó con pruebas y huellas, sin emitir
comprobantes. Publicar el nuevo instalador sigue siendo un paso separado.

## Rollback

Para detener nuevas operaciones RADAR:
`UPDATE radar_settings SET enabled=0 WHERE id=1;`.
Conservar sus tablas y la deduplicación. Si fuera necesario revertir el código,
publicar la versión anterior indicada arriba mediante el procedimiento de
versiones de Wrangler. No restaurar toda D1 sobre datos nuevos para desactivar
una capacidad ni aplicar 0013 como parte del rollback.
