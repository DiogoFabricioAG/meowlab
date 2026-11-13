# GRE: interpretación y ubicaciones — 2026-11-06

## Problema y cambio

La guía mantenía un extractor independiente del de facturación. Exigía fechas
literales con año y comparaba otra vez el texto después de la interpretación.
Además, el mensaje clasificaba el error de traslado como emisión y presentaba
una etiqueta por error, duplicando partida y llegada.

El contrato GRE `interpretation_version: 1` entrega a Luna la interpretación de
fechas relativas, erratas comprensibles, peso y ubicaciones. Devuelve valores
normalizados y citas del usuario; el código comprueba procedencia, calendario,
forma del payload, fechas de negocio, autorización e idempotencia. No vuelve a
exigir la escritura original del valor normalizado. El decodificador anterior
permanece para compatibilidad con respuestas sin versión.

El checkpoint conserva los campos omitidos, las preguntas pendientes y los
nombres de lugares entre mensajes. Las preguntas se agrupan en Fechas, Punto de
partida, Destino, Peso, Vehículo y conductor, y Productos, sólo cuando corresponde.
M1/L sigue exento de vehículo/conductor. Los bienes y cantidades precargados de
la factura se conservan salvo modificación explícita. Una conversación sin
cambios conserva el borrador y su confirmación. Cambiar datos invalida el botón
previo; sólo un botón vigente puede autorizar el envío fiscal.

## Ubigeo sin memorizar códigos

El modelo interpreta nombres de distrito, provincia y departamento. El módulo
`src/geography/ubigeo.ts` busca esos nombres en un catálogo versionado; no analiza
el mensaje con reglas léxicas ni consulta un proveedor externo durante el turno.
Una coincidencia completa el código; varias coincidencias conservan una pregunta
de ubicación. No se escoge el primer homónimo. Un código escrito directamente
también debe existir en el catálogo y estar respaldado por la cita exacta.

“Almacén del proveedor” no acredita una dirección ni distrito. Se pide el punto
exacto, sin usar silenciosamente el domicilio fiscal de ninguna empresa.
Al cambiar un distrito, una calle guardada se conserva y se pregunta si se
mantiene cuando el usuario no ha aportado una dirección nueva.

### Procedencia del catálogo

- INEI SISCONCODE, **UBIGEO AÑO: 2026**, versión `9-1`.
- Descargado el 2026-11-06 por HTTPS con verificación TLS.
- 1.893 distritos únicos; jerarquía verificada contra 25 departamentos y
  196 provincias de la misma respuesta.
- Endpoint oficial:
  `https://webapp.inei.gob.pe:8443/sisconcode/ubigeo/listaBusquedaUbigeoPorUbicacionGeografica.htm`.
- Parámetros: `versionCategoriaPK=9-1`, `nivel=1`, `strVersion=2026`,
  `strDpto=TODOS`, `strProv=TODOS`, `strDist=TODOS`, `flagDpto=`, `flagProv=`,
  `flagDist=`.
- SHA256 de `src/geography/ubigeo-catalog.ts`:
  `e63473a860fc9c5ab804850a18768edfb65ac4d0edb33c11bbd2a1a5228960bb`.

Actualización reproducible, desde el Worker:

```powershell
python tools/update-ubigeo-catalog.py
```

Requiere `requests` y `beautifulsoup4`; genera sólo datos públicos y valida códigos
únicos y jerarquía. Revisar el diff y ejecutar `test/ubigeo.test.ts` antes de una
nueva publicación. Nuevas divisiones territoriales requieren actualizar este
snapshot. Si un lugar no existe, se pide aclaración y no se inventa su código.
La [consulta oficial del INEI](https://www.gob.pe/15028-consultar-codigos-estandarizados-del-inei)
documenta el servicio de códigos estandarizados.

## Validación y operación

La entrega usa una copia aislada del Worker activo `8fa4bcb6`, sustitución
reversible del constructor del rol y cierre de dependencias. Conserva los bytes
del resto del runtime, namespace Durable Object, bindings, variables, secretos,
cron y compatibilidad. No modifica el bridge
`sha256:29c6582f7e7ed6592209dced3d535721b663f3384c962b0565bbc1caa4d75248`.
No necesita migración ni reescritura de sesiones.

Los tests simulan la respuesta del modelo y FacturaYa. Comprueban persistencia,
resolución de homónimos, rechazo de códigos inventados, recuperación y botón
fiscal; no prueban la calidad de inferencia de Luna. La evaluación real sigue
pendiente en el tablero por la credencial local que respondió 401 anteriormente.
No se envían mensajes de WhatsApp ni se emiten guías para validar esta entrega.

Artefactos locales privados: `backups/gre-semantic-20261106/` dentro del Worker.
Los snapshots de configuración y datos no se agregan al repositorio ni se
incluyen en la copia de código al VPS.

Validación final:

- Worker activo al 100%: `b82f74d9-f05f-4902-bb17-82c6b10b7f4b`.
- Runtime activo idéntico al dry-run, SHA256:
  `c867771a873454e9df69a882eea1463279e58ab04a8f866283814af9650d63c9`.
- Salud pública 200, bridge saludable sin reconstrucción ni reinicio;
  agrupación activa, bindings/secretos/compatibilidad/cron conservados.
- `npm run typecheck`: correcto.
- `npm test -- --run --maxWorkers=2`: 536 pruebas, 45 archivos.
- Paquete aislado: 439 pruebas, 25 archivos, `maxWorkers=2`.
- `wrangler@4.157.0 deploy --dry-run`: correcto. El plugin de pruebas usa
  Wrangler 4.113 y advierte sobre `observability.redact_query_string`; la
  publicación utiliza 4.157 y conserva la configuración activa.
- La comparación del cierre con la entrega anterior sólo cambia los módulos
  GRE y añade el catálogo/resolución geográfica y el merge semántico GRE.
- Código replicado por SSH en
  `/opt/manolo-platform/releases/gre-semantic-20261106`.
- SHA256 comprobado en ambos extremos del archivo `release.tar.gz`:
  `2bd4be4439e2f32fc97c0f09cc47a37cc1ce0693610e321319dafd89ea77e256`.

## Rollback

Restaurar sólo el Worker `8fa4bcb6-6790-48ee-9276-1517c144aa4e`. Mantener el
bridge, el namespace Durable Object y los checkpoints. No restaurar bases ni
secretos. Comprobar salud, versión al 100%, agrupación y contratos de bindings.
El estado nuevo agrega propiedades opcionales que el lector anterior ignora.
