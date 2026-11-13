# GRE: memoria, factura y preguntas — 2026-11-06

## Diagnóstico y comportamiento

La sesión de guía heredaba `phase=issued` de la factura anterior. Aunque el estado
GRE interno estaba en `collecting`, una nueva intención de guía podía reiniciarlo.
Al iniciar GRE ahora se limpia la fase terminal anterior; un checkpoint legacy
con GRE collecting/creating/review y padre issued se corrige sin borrar sus datos.
Elegir factura conserva fechas, direcciones, categoría y evidencia previas.

Las listas excluyen facturas con notas de crédito aceptadas. La vigencia se
revalida al elegir, preparar y confirmar; un fallo de lectura bloquea el envío.
Se usa un criterio conservador: cualquier nota aceptada excluye la factura,
incluidas notas parciales; aún no hay cálculo de cantidades netas tras créditos.
Los botones Siguiente/Anterior reemplazan la necesidad de escribir páginas.
Se conservan hasta diez facturas por lista, con navegación en botones separados.

Al seleccionar, se leen descripción y cantidad desde el detalle autorizado de la
factura y se precargan en la guía. El usuario puede corregir un traslado parcial;
el resumen y botón vigentes siguen siendo obligatorios. El gateway fiscal actual
de FacturaYa usa NIU para líneas de factura; se conserva una unidad explícita si
la API la proporciona. No se inventan cantidades ni se calculan desde importes.
Las preguntas muestran sólo pendientes, en líneas separadas, viñetas y negritas.

## Contrato

Extensión aditiva de `list_invoice_drafts`: `payload.draftId` ULID opcional lee
`GET /api/invoice-drafts/{id}` y devuelve un arreglo de un elemento. Sigue usando
HMAC, resolución de empresa y permiso `view_invoice`. No se agregan rutas públicas,
secretos ni permisos. Sin draftId mantiene la paginación previa. Se comprueba la
identidad del detalle devuelto; la API mantiene aislamiento por empresa.

## Publicación

- Worker `173dde02-c427-4738-a0c5-521459cf3b4f`, al 100%; previo `756ae5a6`.
- Bridge nuevo `sha256:29c6582f7e7ed6592209dced3d535721b663f3384c962b0565bbc1caa4d75248`.
- Bridge previo `sha256:84ee1c657f154b4e2f4aeda4c7797eff7db9d7036162c6964c6a429995d562f8`.
- Sólo se sustituye `fiscal-extension.mjs` en la imagen anterior; server, RADAR,
  configuración, secretos y montajes preservados. Huella operativa comparada.
- Runtime Worker activo idéntico al dry-run, SHA256
  `dde1823769fce835499a7107904daf017632362189d03c5774ee77830038dca6`.
- Extensión bridge SHA256
  `4dad7b3ec04d2136984b0586ac1121ac5621b31b3e4914bf03fa0df244607db9`.
- Paquete final en `/opt/manolo-platform/releases/gre-fixes-20261106`, SHA256
  `7c2732b6f9e3b65cbe7d9ee526a1503668e3b2bb1acc76078e4b3d4041df8f16`.

## Validación y rollback

499 pruebas/44 archivos antes del último test de detalle; después 27 pruebas de
multiempresa correctas. Paquete final aislado: 403 pruebas/24 archivos correctas,
incluida la compatibilidad de candidatos legacy. Typecheck, build Node y dry-run
Wrangler4.157 correctos. Respaldo PostgreSQL restaurado en contenedor aislado:
37 tablas. Pruebas de salud, HMAC, permisos, replay y preservación RADAR en staging
y bridge activo; sin llamadas fiscales reales. Salud pública Worker200, bindings,
compatibilidad, agrupación y cron conservados. Staging retirado.

El cambio no habilita credenciales GRE ni altera el backend de FacturaYa. Sin
migraciones, commit, emisión real ni reescritura manual del checkpoint del usuario.
Los datos perdidos por un reinicio anterior no se reconstruyen inventándolos.

Rollback: primero Worker a `756ae5a6-be57-46eb-8269-5891b17263c7` mediante Wrangler;
luego `python3 /opt/manolo-platform/releases/gre-fixes-20261106/deploy.py rollback`.
No restaurar datos antiguos sobre comprobantes o guías ya enviados.
