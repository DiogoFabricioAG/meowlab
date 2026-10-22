# 0002. Agrupar ráfagas de WhatsApp por conversación

- Estado: aceptado; recuperación implementada y activación de producción autorizada.
- Fecha: 2026-10-22.
- Responsables: fundador de MeowLab y mantenimiento de Manolo.

## Contexto

Una persona suele repartir una petición entre varios mensajes: saludo, producto,
cantidad, documento, importe y fecha. El webhook anterior inicia un handler por
mensaje, incluso concurrentemente. Esto genera consultas con contexto parcial,
respuestas redundantes y conflictos de checkpoint. Una pausa en memoria o un
`setTimeout` en cada petición no coordina distintas instancias del Worker.

## Decisión

Introducir `WhatsAppBurst`, un Durable Object SQLite por la tupla exacta
`[tenantId, phoneNumberId, destinatario]`, después de validar la firma Meta y
de separar comandos RADAR. El Worker sigue siendo el único webhook público.
El binding RPC es interno; no se abre una ruta de cola pública.

El webhook confirma recepción sólo después de guardar la entrada y programar
su alarma. Si el almacenamiento, tenant o admisión fallan, devuelve 500 para
que Meta reintente; no cae al procesamiento inmediato silenciosamente.

- Texto sin interacción: debounce de 3.000 ms desde el último fragmento.
- Máximo 10.000 ms desde el primero, 20 fragmentos u 8.000 caracteres por lote.
  Al alcanzar un límite se divide, nunca se trunca. La espera real también
  depende del despacho de alarmas y de turnos anteriores, no es un SLA de 3 s.
- Los botones/listas, audios, imágenes y documentos son barreras FIFO. Cierran
  el texto previo y se procesan individualmente, sin reinterpretar el ID de un
  botón como texto. No tienen debounce adicional, pero esperan al turno anterior.
- Un único turno en ejecución por objeto; las entradas que llegan durante una
  inferencia se conservan para el siguiente turno. Conversaciones distintas no
  comparten la cola. Se respeta orden de admisión, no se inventa orden de envío
  si Meta entrega mensajes fuera de orden.
- Se conservan todos los originales e IDs en D1, deduplicados. La copia sombra
  recibe los originales, no sólo el mensaje unido. El modelo recibe un único
  texto con saltos de línea, sin incluir esos originales otra vez en el historial
  de ese mismo turno. Se vuelve a comprobar tenant y rol al procesar.
- Una entrada al rol por lote, no una garantía de una sola llamada externa en
  todo el flujo: extracción, consulta DNI, importación y respuesta siguen siendo
  operaciones separadas del dominio. Las llamadas visuales/audio no se agrupan.
- No cambia la autorización fiscal: sólo el botón vigente y entregado autoriza
  emisión. Una edición anterior al clic se procesa primero e invalida el botón
  viejo mediante el checkpoint existente.

## Fiabilidad y privacidad

Estados de entrada: `pending`, `executing`, `done`, `uncertain`. La entrada en
ejecución se marca antes de invocar el dominio. Un fallo/crash posterior puede
haber causado efectos externos: no se reejecuta automáticamente y no se promete
exactly-once entre DO, D1, Meta y FacturaYa.

Una operación interrumpida fija un bloqueo durable de creación fiscal; futuros
clics de Crear reciben aviso de revisión administrativa, incluso tras expirar
el payload. El administrador debe reconciliar D1 y FacturaYa antes de liberar
el bloqueo. No existe un desbloqueo por WhatsApp ni un endpoint público nuevo.
La recuperación administrativa está implementada en la release aislada
`apps/manolo-whatsapp-worker/releases/bursts-20261022`: endpoint HMAC con cuerpo
limitado, timestamp, request ID firmado y contacto/tenant resueltos desde D1.
Inspeccionar devuelve una huella del estado; liberar exige esa misma huella,
cola drenada, referencia de revisión y confirmación explícita de comprobación
manual en FacturaYa. Rechaza fase `issuing`, invalida botones antiguos por CAS,
conserva productos y audita/deduplica la acción. La CLI vive en
`apps/manolo-whatsapp-worker/infra/vps/burst-admin.mjs` y lee Docker Secrets
dentro del bridge por SSH, sin publicar credenciales.

El payload de un turno correcto se elimina de la cola al terminar; su tombstone
de deduplicación permanece hasta 24 h. Los inciertos conservan el payload hasta
24 h para reconciliación, con alarma de limpieza aun sin tráfico nuevo. Los
pendientes no se borran por antigüedad: se conservan hasta procesar/reconciliar
para no perder entradas ya confirmadas. Límite de 100 pendientes por objeto;
al saturarse se rechaza la nueva admisión, no se elimina trabajo previo.
Logs sólo de evento y cantidad, sin mensajes, documentos, teléfonos o tokens.

D1 sigue siendo autoridad de conversaciones, historial y checkpoints; PostgreSQL
sigue autorizando FacturaYa. El DO es una bandeja de entrada transitoria, no
una migración de memoria al VPS ni un reemplazo de los checkpoints CAS.

## Alternativas consideradas

- Esperar dentro de cada webhook: no coordina instancias y mantiene trabajo
  dependiente del ciclo de vida de `waitUntil`.
- Locks en memoria: no sobreviven reinicios ni coordinan réplicas.
- D1 con sondeo/locks: exige scheduler y leases propios para una ventana corta.
- Cola general/VPS: válida para una futura unificación, pero el debounce de
  baja latencia y el orden por conversación necesitan coordinación adicional.

## Adopción y rollback

`WHATSAPP_BURST_ENABLED=false` en ambos entornos por defecto. El despliegue
requiere binding `WHATSAPP_BURSTS`, export `WhatsAppBurst` y migración DO nueva
`whatsapp-bursts-v1`; no hay migración D1 ni cambio del VPS. No se activa en esta
entrega local inicial. Antes de activar: comprobar recuperación administrativa y
bindings de la versión activa (incluido RADAR), probar el flujo fiscal con
respuestas simuladas y validar ráfagas reales sin emitir.

No desactivar la bandera con pendientes: las alarmas ya admitidas siguen
procesando y podrían competir con el camino inmediato. Para rollback, detener
ingreso por una ventana operativa acordada, drenar/reconciliar todos los objetos
y sólo entonces publicar la bandera en falso o la versión anterior. No borrar
clases, storage o migraciones para hacer rollback. El despliegue de código local
no debe arrastrar cambios de otros agentes ni revertir la configuración RADAR.

## Evidencia de validación

`test/whatsapp-burst.test.ts`: política de ventana/límites, barreras, aislamiento,
deduplicación durable, firma y ACK de admisión, alarma real local, preservación
de originales, una consulta conjunta para cinco textos, llegada durante
inferencia, bloqueo de creación tras incertidumbre y prompts de más de 4.000
caracteres. Validación general y estado de entrega en `docs/project/status.md`.

Referencias primarias: [alarmas](https://developers.cloudflare.com/durable-objects/api/alarms/)
y [reglas de Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
