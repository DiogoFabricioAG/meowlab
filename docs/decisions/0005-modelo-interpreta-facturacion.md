# 0005. El modelo interpreta los mensajes de facturación

- Estado: aceptado
- Fecha: 2026-11-06
- Responsable: MeowLab / Manolo

## Contexto

El extractor entendía expresiones del usuario, pero validadores léxicos posteriores
podían descartar la interpretación. Ejemplos: año abreviado en `06/12/26`, importes
escritos con palabras y números de orden confundidos con documentos del cliente
por el fallback. Ampliar expresiones regulares no resuelve la frontera de responsabilidades.

## Decisión

El contrato semántico `interpretation_version:1` hace responsable a Luna de
identificar la intención, normalizar campos, identificar su origen en texto/imagen
y decidir si hace falta aclarar una ambigüedad. Su interpretación no vuelve a
pasar por los clasificadores léxicos heredados de facturación.

`source_evidence` contiene citas del usuario de la sesión actual. Se acredita
su pertenencia a los mensajes del usuario, sin exigir que su escritura coincida
con el valor normalizado. Las afirmaciones previas del asistente no acreditan
datos del usuario. Una omisión explícita del documento del cliente no se rellena
automáticamente con cualquier número encontrado en el OCR.

`payment_clarification` conserva campo y pregunta dentro del checkpoint. El
modelo recibe esa pregunta y el historial para interpretar la respuesta siguiente.
Una petición de resumen que recupera datos puede aplicarlos antes de preparar
la revisión. Los campos omitidos conservan los valores anteriores.

El código valida tipos, fechas de calendario, importes positivos, coherencia
contable y temporal, permisos, idempotencia y persistencia. Sólo el botón vigente
autoriza emitir. El checkpoint D1 sigue siendo la autoridad para datos confirmados;
el modelo no puede certificar un guardado o una emisión por su respuesta libre.

Una respuesta ausente/ilegible del proveedor conserva el checkpoint y avisa del
fallo; no intenta completar la operación interpretando números con un fallback.
El decodificador del formato plano anterior se conserva por compatibilidad con
integraciones existentes; sus heurísticas no se aplican al contrato semántico.

## Consecuencias

No se agregan nuevas reglas para cada manera de expresar una fecha o un importe.
Se necesita evaluar tanto el contrato y los límites del código como la calidad
del modelo al interpretar mensajes reales. Las pruebas con respuestas simuladas
no prueban por sí solas esa calidad. No se eliminan las comprobaciones fiscales
ni los controles de seguridad. No cambian webhook, bases de datos, proveedores
ni contratos privados con el VPS.

## Extensión GRE — 2026-11-06

La guía aplica la misma frontera semántica a fechas, peso y direcciones. Guarda
preguntas y nombres de lugares en el checkpoint existente. El modelo interpreta
los nombres; un catálogo versionado del INEI determina los códigos ubigeo, sin
generarlos de memoria. Los homónimos requieren aclaración. Esta búsqueda de
datos estructurados no sustituye la interpretación del mensaje por reglas.
[Procedencia, validación y operación](../operations/manolo-gre-locations-2026-11-06.md).
