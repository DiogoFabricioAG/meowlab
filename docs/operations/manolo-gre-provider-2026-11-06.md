# GRE: solicitud compatible con Luna — 2026-11-06

La captura muestra respuestas repetidas de “No pude interpretar este mensaje”.
Ese texto cubría tanto ausencia de respuesta del proveedor como JSON ilegible;
no demostraba un fallo al interpretar una fecha o ubigeo.

Se encontró un defecto verificable en el cuerpo HTTP: GRE no indicaba
`reasoningEffort` y el adaptador enviaba `temperature: 0` a `gpt-6-luna`.
Facturación sí indicaba esfuerzo y omitía ese parámetro. La
[documentación oficial](https://developers.openai.com/api/docs/guides/latest-model)
indica retirar temperature cuando el esfuerzo no es none; Luna usa razonamiento
por defecto. Esto permite explicar un rechazo de la solicitud antes de interpretar
los datos, pero no acredita por sí solo el estado HTTP de cada intento reportado.

Corrección: el adaptador oficial omite temperature en los modelos de razonamiento
también cuando el esfuerzo no está definido. GRE usa esfuerzo high y presupuesto
de 8.000 tokens, igual que facturación. Los proveedores compatibles externos
conservan su formato previo. Se añade el evento `whatsapp_gre_interpretation_failed`
con motivo provider_unavailable/invalid_json y longitud, sin mensajes ni contenido
del proveedor. El checkpoint anterior se conserva ante fallos y el mensaje se guarda como evidencia pendiente para recuperarlo en otro turno; el intento fallido
no se presenta como guardado.

La consulta de logs históricos de Workers Observability devolvió HTTP403 con la
credencial disponible. La captura y el cuerpo de solicitud son evidencia del
diagnóstico; no se declara recuperado el error histórico del proveedor. La
evaluación real con credencial válida sigue pendiente en el tablero. Las pruebas
de contrato simulan HTTP y no acreditan calidad de inferencia real.

Artefactos privados en `backups/gre-provider-20261106/` y
`backups/gre-failure-20261106/` dentro del Worker. Baseline y rollback:
`b82f74d9-f05f-4902-bb17-82c6b10b7f4b`. Conservar checkpoint, DO y bridge;
no requiere migración ni cambio de secretos. No se envían mensajes ni se emiten
documentos fiscales para esta validación.

Validación: typecheck y 537 pruebas generales correctas. La prueba nueva verifica
el cuerpo HTTP con esfuerzo omitido: modelo exacto, JSON y ausencia de temperature.
La prueba GRE verifica esfuerzo/presupuesto, persistencia del mensaje pendiente,
campos confirmados conservados y motivo de error sin contenido sensible.
