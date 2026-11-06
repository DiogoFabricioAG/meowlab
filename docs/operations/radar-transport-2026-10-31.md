# Corrección de transporte RADAR — 2026-10-31

## Incidente observado

El usuario seleccionó la convocatoria pública `ocds-dgv273-seacev3-1258591`
(chalecos Warmi Ñan) y solicitó recibirla por WhatsApp. Se hizo un solo intento
autenticado con su instalación existente y ventana real abierta. La API devolvió
`unknown`; D1 conservó ese estado sin ID de Meta. El usuario confirmó que no llegó.
Se registró el resultado incierto en la deduplicación local y no se reenvió.

## Causa reproducida

Los dos transportes de RADAR (`sendAlert` y el acuse de vinculación) tenían
`redirect: "error"`. Workers rechaza ese modo al construir `Request`, antes de
enviar tráfico. Las pruebas antiguas sustituían `fetch` y no validaban opciones
con el constructor nativo. La regresión nueva falló con el TypeError real y pasa
al cambiar a `manual`, manteniendo el rechazo de respuestas no exitosas.

Referencia: [Request de Workers](https://developers.cloudflare.com/workers/runtime-apis/request/).
No se seguirán redirecciones ni se reenviará Authorization a otro destino.

## Preparación y publicación autorizada

- Fuente activa comprobada: `b406aab4-86cc-4dfd-a8cd-4d0a5edb9fe6`.
- Parche de sólo dos literales de transporte sobre el bundle publicado;
  verificación inversa conserva el resto de roles, ráfagas y runtime.
- Generador: `tools/prepare-radar-transport-release.mjs`.
- Snapshot/paquete privados: `backups/radar-transport-20261031/`.
- Pruebas: 26 específicas del árbol local, typecheck, 19 del paquete aislado y
  dry-run Wrangler 4.156.0 correctos. Incluye constructor nativo y rechazo de 302.
- Sin migraciones, cambios de contactos o de permisos de notificación.

El propietario autorizó explícitamente publicar y hacer un único reintento.
Se refrescó la sesión OAuth mediante Wrangler, se comprobó de nuevo el baseline
y se publicó la versión `ddb238b3-6d07-47f5-920c-c4a5be3c04c0`, conservando
variables, bindings, handlers y ráfagas mediante la entrega aislada y `--keep-vars`.

Tras comprobar salud y ventana real, se reconcilió únicamente el intento anterior:
CAS por instalación, OCID, hash del contenido, estado `unknown`, ID Meta ausente
y fecha exacta del intento. Se conservó el registro, cambiándolo a `rejected`
para permitir el único reintento autorizado con la misma clave y payload.
No se habilitan reintentos genéricos de resultados inciertos; este caso tiene
evidencia de un error determinista anterior al envío. Si cambia el estado o
aparece un ID de proveedor, se detiene la reconciliación.

## Verificación real

- Reintento por la API autenticada del escritorio: HTTP 200, `accepted`,
  `replayed=false`, a las 16:50 UTC del 2026-10-31.
- D1: ID de proveedor presente y `delivery_status=read` por callback Meta.
- Deduplicación local: misma instalación/OCID registrada como `accepted`.
- Horario, rol y autorizaciones del contacto conservados; no se enviaron otras
  convocatorias ni mensajes de prueba adicionales.
- Fuente de la convocatoria: SQLite real de RADAR, vigente hasta el
  2026-11-03 23:59 America/Lima. Monto no publicado: «Monto por confirmar».
  La ficha OCDS no se había podido verificar y el mensaje usó el buscador oficial
  SEACE con la nomenclatura real, en lugar de una URL de detalle no acreditada.
