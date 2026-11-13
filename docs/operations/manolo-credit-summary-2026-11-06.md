# Manolo: resumen de anulación sin modificar motivo — 2026-11-06

## Causa

El controlador de notas de crédito ignoraba la intención `review` y enviaba el
mensaje al extractor de cambios. Además, `inferReasonCode` infería código01 al
encontrar «anul» en cualquier texto; usaba la frase completa como descripción.
Por eso «Muéstrame el resumen de la anulación» podía reemplazar el motivo guardado.

## Corrección

`enterprise-intent.ts` distingue los pedidos puros de resumen antes del fallback
de anulación y conserva esa distinción ante una elección errónea del modelo.
Decisions sigue ejecutándose para clasificar los textos; una revisión semántica
tampoco se convierte en actualización. Los pedidos que mezclan cambios y revisión
siguen pasando por extracción; una revisión pura no extrae campos.

`enterprise-advisor-role.ts` separa `reviewCreditNote` de la actualización del
checkpoint. Revisión preserva número afectado, motivo/código y fecha; consulta
el comprobante autorizado y renueva sólo metadatos de revisión/confirmación.
Invalida el botón anterior antes de entregar el nuevo resumen. Resúmenes sin
datos piden los faltantes sin crear un motivo01. Conversación y revisión del
extractor tampoco se aplican como cambios fiscales.

Una nota ya procesada muestra su referencia y motivo sin habilitar otra
confirmación. Si está pendiente de verificar, conserva el bloqueo. Se mantienen
las comprobaciones de permisos, empresa/contacto y respuesta incierta.

## Publicación y evidencia

Worker final `85802e7f-99bb-4907-a4df-101fedb2388c` al100%, sobre la revisión
intermedia `578628be-94bb-4af3-8066-bdca70678cf4`; base estable de inicio
`0bedb1c8-c6e0-4f6e-8ab7-45d8fd7258f9`. La revisión final añade la protección
de resúmenes de notas ya procesadas. Bridge fiscal `84ee1c65` conservado.

342 pruebas aisladas/21 archivos, 114 focales/3 archivos y typecheck correctos.
Cubren la frase exacta reportada, revisión semántica, código06 y fecha conservados,
falta de motivo, botón anterior inválido, payload original al confirmar y resumen
posterior a emisión sin reemitir. Dry-run y publicación con Wrangler4.157.0.

Los generadores `snapshot-credit-summary-release.mjs`,
`prepare-credit-summary-release.mjs` y `verify-credit-summary-worker.mjs`, relativos
al paquete Manolo, usan la base final inventariada. Cambian un único constructor
del runtime activo, comprobando sustitución inversa; no reconstruyen otros dominios
desde el árbol con cambios pendientes. Configuración/secretos, ráfagas y cron
quince minutos preservados, sin migraciones, commit o reinicio del bridge.

Artefactos privados iniciales en `backups/credit-summary-20261106/` y finales en
`backups/credit-summary-final-20261106/`. Copia final por SSH en
`/opt/manolo-platform/releases/credit-summary-final-20261106`, paquete SHA-256
`a8a66c1c9a15fa707ea343cf3e36fa25b20126a018d02a97fa84e430225f2e07`,
cotejado local/VPS. Evidencia de código/configuración/salud en
`after/worker-verification.json` del respaldo privado final.

Durante el diagnóstico se encontró una nota ya procesada y aceptada por SUNAT
según la respuesta persistida de FacturaYa (código0, XML/CDR disponibles).
No se restauró el borrador sobre ese registro ni se alteraron datos emitidos.
La corrección del agente no emitió ni reenvió operaciones fiscales reales.

## Rollback

Antes de revertir, revisar operaciones pendientes y proteger la confirmación de
notas de crédito, pues las versiones anteriores conservan el defecto de revisión.
Con configuración validada y sesión Wrangler:

```sh
npx wrangler@4.157.0 rollback 0bedb1c8-c6e0-4f6e-8ab7-45d8fd7258f9
```

No revertir permisos autorizados, borrar checkpoints o editar documentos emitidos
como parte del rollback de código. Bridge sin cambios; comprobar salud y ráfagas.
