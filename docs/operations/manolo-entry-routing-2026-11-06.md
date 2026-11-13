# Decisions en la entrada y respuestas breves — 2026-11-06

## Comportamiento publicado

Decisions API enruta la entrada y las nuevas gestiones después de terminar.
Una factura, boleta, anulación o guía activa recibe datos directamente en Luna
con el checkpoint correspondiente, sin Decisions intermedio. Fotos/documentos
continúan la gestión elegida, incluso si su texto contiene palabras de navegación.
Botones, revisión, cancelación y navegación explícita conservan sus controles.
Consultas de borradores y paginación mantienen el acceso autorizado existente.

El modelo recibe instrucciones de responder con palabras cotidianas y máximo
dos frases cortas de avance. El respaldo textual evita repetir los datos
guardados. Una respuesta conversacional dentro de facturación no reabre el menú.
Los resúmenes de revisión siguen completos y sólo el botón vigente permite emitir.

## Entrega y comprobaciones

- Worker al 100%: `79ffc31d-13b1-4be2-89c3-7d8a36db8860`.
- Anterior: `8c75c490-06b1-4fe2-8cd4-4346f4377d4e`.
- 488 pruebas en 44 archivos de trabajo y typecheck correctos.
- Paquete aislado: 391 pruebas en 24 archivos, todas correctas.
- Dry-run y publicación con Wrangler 4.157.0.
- Runtime descargado idéntico al dry-run; SHA256
  `e08ba4cb9816f6786652b59575a60275ee602e5ab57e3515a97fafda5d68b270`.
- Bindings, variables, secretos, compatibilidad y cron conservados.
- Agrupación habilitada y namespace durable conservado.
- Salud pública200 y bridge fiscal saludable, misma imagen, sin reinicio.

Paquete aislado y recibo seguro en el VPS:
`/opt/manolo-platform/releases/entry-routing-20261106`.
SHA256 del archivo fuente comprimido:
`9fa08a40a87a433655c2a302788bf80997bd51168abc3ccc6d8f31b6bf974338`.
Respaldo privado local bajo `backups/entry-routing-20261106`, excluido de Git.
Sin cambios de estado de clientes, migraciones, commit ni emisión fiscal de prueba.

## Rollback

Desde el paquete Worker:
`npx wrangler rollback 8c75c490-06b1-4fe2-8cd4-4346f4377d4e`.
Conservar el namespace DO y los checkpoints; no restaurar datos antiguos sobre
operaciones fiscales procesadas. El bridge no requiere rollback para esta entrega.
