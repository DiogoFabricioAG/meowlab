# Diagnóstico: importe reconocido pero rechazado — 2026-11-06

## Evidencia

Los mensajes registrados muestran entradas con el importe agrupado y respuestas
posteriores alternando reconocimiento y solicitud de importe. El checkpoint
actual ya pertenece a una guía: no se reconstruyó ni modificó el borrador de
facturación anterior. No se dispone del JSON exacto del extractor en ese turno.

Reproducción local sobre el módulo actual de condiciones de pago:

| Entrada | Importe esperado | hasExplicitAmount |
| --- | --- | --- |
| `12630 soles` | `12630.00` | true |
| `12,630 soles` | `12630.00` | false |

`decimalAmount('12,630')` devuelve null: el contrato interno sólo acepta decimal
canónico. El validador de evidencia tampoco normaliza separadores de miles.
Esto reproduce un rechazo compatible con el caso reportado, independientemente
de que el modelo entregue el importe canónico o lo copie con agrupación.

## Generación de mensajes

El extractor propone cambios; paymentPatch valida evidencia y produce datos o
paymentError. El checkpoint guarda el estado estructurado resultante. Ante un
problema de pago, replyBillingProgress usa billingProgressFallback: la plantilla
«Datos guardados. Me falta…» no prueba que se haya aceptado ese campo concreto.

La rama conversation puede devolver reply generado a partir del historial sin
aplicar una actualización comercial. Por eso una disculpa o reconocimiento puede
referirse al mensaje leído mientras el campo del borrador sigue sin validar.
Las instrucciones de prompt que prohíben esa contradicción no son una garantía.

## Trabajo pendiente

Normalizar formatos monetarios de usuario antes de contrastar evidencia, sin
relajar el contrato fiscal canónico ni aceptar identificadores/fechas como dinero.
Resolver ambigüedades con una pregunta específica. Conservar procedencia y un
resultado de aceptación/rechazo por campo; no perder datos válidos por campos
omitidos en mensajes posteriores. Generar las confirmaciones sólo tras persistir
y desde el resultado guardado. Un rechazo debe explicar el formato concreto,
evitando «Datos guardados» para el campo rechazado y evitando repetir una pregunta
genérica. Probar el recorrido completo: importe agrupado, reclamación y petición
de resumen, con conservación de vencimiento/productos y botón fiscal vigente.

Esta entrega es diagnóstico y planificación; no modifica runtime, no reescribe
sesiones y no publica una corrección. Sin emisiones ni llamadas fiscales.
