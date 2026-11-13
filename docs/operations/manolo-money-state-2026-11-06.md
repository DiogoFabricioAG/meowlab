# Importes y respuestas desde checkpoint — 2026-11-06

## Comportamiento

Normaliza importes de usuario antes de contrastar evidencia: `12,630`,
`12,630.50`, `12.630,50`, `12630,50` y campos numéricos del extractor. Las
cantidades internas mantienen el contrato decimal canónico y la aritmética en
céntimos. Una forma ambigua como `12.630`, signos negativos, agrupaciones inválidas
o precisión no admitida se rechazan sin borrar el saldo previamente validado.
No convierte monedas ni usa fechas o identificadores como importes.

Un importe enviado solo durante un pago único a crédito se trata como actualización
de pago aunque el modelo lo clasifique como conversación. Conserva cliente,
productos y vencimiento. La confirmación anterior se invalida antes de preparar
otro resumen; siguen vigentes total canónico, validación de crédito y botón fiscal.

El checkpoint conserva `billing.paymentUpdate` con ID de mensaje de origen,
resultado por campo de pago (accepted/rejected/retained) y motivo cuando existe.
Es metadata opcional en JSON, compatible con checkpoints previos y sin migración.
Los campos omitidos o un importe propuesto sin evidencia nueva no sustituyen el
saldo validado. Un rechazo conserva los valores anteriores y bloquea confirmación
hasta resolver el cambio pendiente.

Las respuestas de avance, conversación y actualización sin cambios en facturación
se construyen desde el estado persistido; ya no muestran el reply libre del modelo.
El modelo sigue extrayendo datos, pero no decide qué afirmar como guardado. Un
importe rechazado recibe orientación específica en lugar de «Datos guardados».
Un fallo de persistencia mantiene el manejo de error existente antes de confirmar.

## Publicación y evidencia

- Worker activo al100%: `c4ffeab5-f787-4014-ad49-461c4d6370f1`.
- Previo: `173dde02-c427-4738-a0c5-521459cf3b4f`.
- 518 pruebas/44 archivos de trabajo; typecheck correcto.
- Paquete final: 421 pruebas/24 archivos, con maxWorkers2; 158 pruebas de lógica
  adicionales en Node. Primer intento aislado interrumpido por bloqueo del entorno;
  el paquete final completó la validación antes de publicarse.
- Regresiones: miles/decimales, modelo numérico, rechazo ambiguo conservando saldo,
  reclamación, resumen y propuesta de precio histórico sin sobreescribir saldo.
- Dry-run y publicación con Wrangler4.157; código activo idéntico al dry-run.
- Runtime SHA256 `0e97937155ba353dfc487a49dd82a45c33cbd3004f6c4828f412751c0a8a4cc4`.
- Bindings, secretos, compatibilidad, cron, agrupación y namespace DO conservados.
- Salud pública200; bridge saludable, imagen `29c6582f` conservada sin reinicio.
- Copia fuente y recibo en `/opt/manolo-platform/releases/money-state-20261106`.
  Archivo SHA256 `7d2c9270e102b35c3a4710d0ff60d7feb64112b92ab1b8373178e8fe722cc023`.

Sin commit, migraciones, reescritura de conversaciones actuales ni emisión fiscal.
El diagnóstico anterior describe el comportamiento histórico, sin actualizarlo
para aparentar que ya contenía esta corrección.

## Rollback

Desde el paquete Worker:
`npx wrangler rollback 173dde02-c427-4738-a0c5-521459cf3b4f`.
Conservar el namespace DO y los checkpoints; no restaurar sesiones anteriores
sobre operaciones fiscales procesadas. No requiere rollback del bridge.
