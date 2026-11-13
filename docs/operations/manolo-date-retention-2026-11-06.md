# Vencimiento relativo conservado — 2026-11-06

El mensaje original especificaba «6 de diciembre de este año». Luna normalizaba
el año, pero el validador exigía año numérico y el checkpoint quedaba sin fecha.
Esto produjo respuestas conversacionales que reconocían la fecha y respuestas
de avance que volvían a pedirla. Además, una fecha de emisión podía provocar la
pérdida de un vencimiento previamente guardado.

Ahora «este año» se resuelve con la fecha de referencia del turno en Perú. No se
infiere el año si falta ni se reinterpreta evidencia histórica relativa con un
año nuevo. Continuaciones e imágenes conservan el vencimiento; cambiar emisión
no lo altera. Un cambio explícito de vencimiento sin año sigue bloqueando la
confirmación. El prompt prohíbe afirmar que un dato faltante ya está guardado.

Se recuperó exclusivamente el borrador pendiente del reporte mediante CAS y
respaldo privado, cotejando el mensaje original y su fecha: vencimiento
`2026-12-06`. Se conservaron emisión, cliente y productos; confirmación anterior
invalidada. No hubo llamadas fiscales ni envío de mensajes.

## Evidencia

- Activo: `756ae5a6-be57-46eb-8269-5891b17263c7`, al 100%.
- Anterior: `79ffc31d-13b1-4be2-89c3-7d8a36db8860`.
- 493 pruebas/44 archivos de trabajo, typecheck correcto.
- 396 pruebas/24 archivos aislados; dry-run/publicación Wrangler4.157 correctos.
- Runtime activo idéntico al dry-run; SHA256
  `3fb1888e7864db0c62f5c485c4aa7eceb2365b3892cb8d5335f4e1ded7da5d96`.
- Bindings, secretos, cron, agrupación y namespace DO conservados.
- Salud pública200; bridge saludable, misma imagen y sin reinicio.
- Copia en `/opt/manolo-platform/releases/date-retention-20261106`;
  SHA256 de `release.tar.gz`:
  `96033a8297aa69c084f264956172ed20aa19c3407c841ba925cfd52fb8257224`.

Respaldo privado en `backups/date-retention-20261106`, excluido de Git.
Sin migración ni commit. Rollback de código desde el paquete Worker:
`npx wrangler rollback 79ffc31d-13b1-4be2-89c3-7d8a36db8860`.
No restaurar checkpoints antiguos sobre documentos fiscales procesados.
