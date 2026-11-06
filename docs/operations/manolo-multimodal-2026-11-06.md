# Manolo: texto e imágenes en un turno — 2026-11-06

## Fallos corregidos

1. Una imagen actuaba como barrera FIFO y cerraba de inmediato el texto anterior,
   aunque hubiera llegado dentro de la ventana de tres segundos. El runtime sólo
   normalizaba el primer elemento de un lote.
2. Pedir «genera la factura» junto con RUC/crédito/datos podía clasificarse como
   `review`; el normalizador vaciaba los campos antes de guardarlos y respondía
   «Todavía no hay datos». La etiqueta visual «SOLO CONTEXTO» tampoco dejaba claro
   que los campos observados eran utilizables como datos comerciales.

## Comportamiento activo

ADR-0004 extiende la cola existente: textos e imágenes contiguos comparten tres
segundos de silencio desde la última entrada, máximo diez segundos, veinte
entradas/8.000 caracteres originales y tres imágenes por turno. Al llegar a un
límite se divide, sin descartar mensajes. Botones/listas, audio y documentos
siguen siendo barreras FIFO. Los mensajes durante inferencia quedan pendientes
para el siguiente turno; no se modifica retroactivamente una operación en curso.

Cada foto se descarga y normaliza con Luna antes de llamar al rol. Sus campos
legibles se consolidan con el texto, preservando el ID/tipo de cada original y
su contenido normalizado en D1 y shadow VPS. Una imagen fallida no elimina los
datos textuales. La imagen no autoriza operaciones ni sus instrucciones sustituyen
las del rol. No se inventan productos ni precios ilegibles; se piden los faltantes.

Pedir crear con datos prepara/actualiza el borrador; no equivale a emitir. La
consulta del resumen conserva los datos y los cambios invalidan el botón previo.
La emisión conserva la exigencia de un botón vigente y entregado.

## Entrega y validación

Worker `b5f73411-1950-4f8d-a8a2-b38e5f25a4dc` al100%, sobre
`85802e7f-99bb-4907-a4df-101fedb2388c`. Bridge fiscal `84ee1c65` conservado.
Sin migraciones, cambios de secretos/permisos, reinicios ni operaciones fiscales
reales. Cron quince minutos y ráfagas activas preservados.

- 471 pruebas de la suite amplia antes de una regresión adicional de lectura;
  comprobaciones focales posteriores correctas y typecheck final correcto.
- Paquete final aislado: 375 pruebas/24 archivos correctos. Incluye webhook,
  RADAR, contratos privados, crédito/GRE, ráfagas y visión. Los fixtures del
  webhook usan credenciales/variables sintéticas; sólo tests RADAR fijan su reloj.
- Prueba del recorrido completo con cliente VPS real contra endpoint simulado:
  texto/imagen en ambos órdenes, RUC y pago guardados, productos de la tabla,
  una decisión/extracción y una respuesta de negocio, originales conservados,
  deduplicación sin volver a analizar, fallo visual sin perder texto e aislamiento.
- Dry-run/publicación Wrangler4.157.0; contenido activo cotejado byte por byte
  con el dry-run y configuración, namespaces DO, bindings/secretos y salud
  verificados mediante `tools/verify-multimodal-worker.mjs`.

`tools/prepare-multimodal-release.mjs` no reconstruye el entrypoint pendiente
del monorepo. Extrae el turno probado como módulo e inyecta las dependencias
efectivas del runtime activo, preservando los otros roles y sus instancias.
Tres sustituciones reversibles: turno, planificador y constructor empresarial.
La sustitución inversa recupera exactamente los bytes anteriores.

Fuentes/manifiesto/artefactos privados en `backups/multimodal-20261106/`.
Copia por `ssh meowlab` en `/opt/manolo-platform/releases/multimodal-20261106`.
`release.tar.gz` SHA-256
`c244229dbfd12ab94cd76f59ff3dbc448e945fe2725504768a475b585598d3ee`,
cotejado localmente y en VPS. No contiene credenciales ni mensajes reales.
La captura del usuario se utilizó como evidencia del fallo; los tests usan datos
sintéticos y respuestas visuales simuladas, sin emitir una factura para probar.

## Rollback

Conservar cola, checkpoints y namespace. No borrar entradas ni reejecutar turnos
inciertos. La versión anterior vuelve a separar las imágenes del texto; las
entradas pendientes mantienen sus originales y media IDs.

Desde la configuración aislada validada:

```sh
npx wrangler@4.157.0 rollback 85802e7f-99bb-4907-a4df-101fedb2388c
```

Verificar salud, configuración y ráfagas. Bridge sin cambios y sin rollback.
