# Interpretación semántica de facturación — 2026-11-06

## Cambio

Aplica [ADR-0005](../decisions/0005-modelo-interpreta-facturacion.md). El contrato
`interpretation_version:1` deja a Luna interpretar fechas, importes, intención y
documentos. Los valores normalizados no vuelven a pasar por los clasificadores
léxicos heredados. Ejemplos cubiertos: `06/12/26`, fechas en palabras e importes
como «doce mil seiscientos treinta soles».

`source_evidence` contiene citas de mensajes del usuario de la gestión actual;
su pertenencia se comprueba sin exigir que coincidan con la escritura del valor
normalizado. El historial del asistente no acredita hechos del usuario.
`payment_clarification` guarda campo y pregunta en el checkpoint para interpretar
la siguiente respuesta. Una revisión que recupera campos puede aplicarlos antes
de preparar el borrador. La ausencia explícita de RUC no se rellena con números
del OCR. Se mantienen validación de calendario, importes positivos, coherencia
de crédito, permisos, CAS, idempotencia y confirmación fiscal por botón.

El formato plano previo conserva su decodificación de compatibilidad. La rama
semántica evita esa reinterpretación; no significa retirar cada expresión regular
del repositorio, incluidas comprobaciones de formato de los contratos internos.
Sin proveedor o sin respuesta JSON legible, el estado se conserva y se informa
el fallo en vez de reconstruir los datos mediante heurísticas de respaldo.

## Entrega

- Worker activo al100%: `8fa4bcb6-6790-48ee-9276-1517c144aa4e`.
- Previo: `c4ffeab5-f787-4014-ad49-461c4d6370f1`.
- 526 pruebas/44 archivos de trabajo y typecheck correctos.
- Paquete aislado final: 429 pruebas/24 archivos, maxWorkers2.
- Dry-run/publicación Wrangler4.157 correctos; runtime activo idéntico al dry-run.
- Runtime SHA256 `702b756f03f08171352c2fd6feb6c17bb0c7516935c5054649f1e293007b23bb`.
- Configuración, secretos, cron, agrupación y namespace durable conservados.
- Salud pública200; bridge `29c6582f` saludable, sin reconstrucción ni reinicio.
- Fuente y recibos en `/opt/manolo-platform/releases/semantic-state-20261106`;
  SHA256 de `release.tar.gz`:
  `e4eb7b1baafb86d03a8e3c5082c7f5ad40b609398add3e46e2827334de701b7c`.

Pruebas nuevas: escritura abreviada y en palabras, recuperación de historia del
usuario, revisión con actualización, pregunta persistida/resuelta, rechazo de
evidencia exclusiva del asistente, calendario/importes inválidos y número de orden
que no sustituye al cliente. No se reescribieron conversaciones ni se emitieron
comprobantes reales. Sin migraciones ni commit.

Los tests de interpretación usan respuestas del modelo simuladas. Una prueba
adicional de inferencia sintética con credencial local devolvió401: no acredita
una interpretación real del proveedor ni implica haber cambiado la credencial
de producción, cuyo contrato de secretos se verificó conservado. La calidad del
modelo debe comprobarse también con mensajes reales; no se declara validada por
las pruebas de contrato.

## Rollback

Desde el paquete Worker:
`npx wrangler rollback c4ffeab5-f787-4014-ad49-461c4d6370f1`.
Conservar checkpoints/namespace DO y verificar operaciones inciertas antes de
restaurar datos. No requiere rollback del bridge.
