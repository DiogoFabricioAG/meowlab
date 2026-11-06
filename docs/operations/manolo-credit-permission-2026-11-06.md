# Manolo: rechazo de anulación por permiso — 2026-11-06

## Diagnóstico confirmado

El intento de las 06:36:14 UTC fue rechazado en el bridge con `forbidden`:
la membresía sólo tenía `view_invoice`, `create_invoice` e `issue_invoice`.
Faltaba `create_credit_note`. Empresa, integración y sesión estaban activas.
La comprobación ocurrió antes de descifrar credenciales y llamar a FacturaYa;
no hubo entrada de auditoría fiscal ni nota de crédito creada por ese intento.

El menú ofrecía anulación sin consultar permisos y el handler dejaba `issuing`
ante cualquier error, incluyendo este rechazo concluyente. Ambos comportamientos
se corrigieron sin reducir las comprobaciones de autorización del bridge.

## Corrección y publicación

- Otras opciones valida la empresa y muestra sólo acciones autorizadas.
  Si necesita selección de empresa, reanuda el menú después de elegirla.
- Antes de preparar o confirmar anulación se vuelve a comprobar
  `create_credit_note`. Un permiso retirado invalida la confirmación disponible.
- Un resultado `forbidden` conserva los datos, invalida el botón y vuelve a
  recopilación. Exige un nuevo resumen y clic; nunca reenvía automáticamente.
- Errores de red o resultados inciertos conservan el bloqueo y la referencia.

Con autorización expresa del usuario, se añadió únicamente `create_credit_note`
a la membresía del usuario/empresa del intento, mediante comparación y actualización
condicional. No se cambiaron otros contactos, empresas, tokens ni permisos.

La recuperación puntual del checkpoint se realizó después de verificar el
rechazo persistido y cero entradas de auditoría. El digest del payload reconstruido
desde el checkpoint coincidió con el sufijo de la clave idempotente rechazada.
Identidad D1/PG verificada por canal/contacto; copia privada previa y escritura
CAS que conserva datos, incrementa revisión, elimina confirmaciones y cambia
`issuing` a `collecting`. No se emitió ni anuló ningún comprobante en esta reparación.

Worker publicado al 100 %: `0bedb1c8-c6e0-4f6e-8ab7-45d8fd7258f9`, sobre
`a768ba36-12c1-4024-8b26-11d7bda4df45`. Bridge `84ee1c65` conservado saludable.
334 pruebas aisladas/21 archivos, 137 focales/4 archivos, typecheck y dry-run
Wrangler 4.157.0 correctos. Contenido activo idéntico al dry-run, SHA-256
`8cfb921585b36747cc4c8b7d7da97f2c11c57130350dad8eed37fdc4d041d92a`.
Salud Worker 200; bindings, variables, secretos, compatibilidad, observabilidad,
cron `*/15 * * * *` y ráfagas activas preservados. Sin nueva migración ni commit.

La entrega aislada sustituye un único constructor en el runtime activo y verifica
que la sustitución inversa restaura sus bytes. Scripts relativos al paquete:
`tools/snapshot-credit-permission-release.mjs`,
`tools/prepare-credit-permission-release.mjs`,
`tools/verify-credit-permission-worker.mjs`.
Artefactos privados en `backups/credit-permission-20261106/`; no incorporar su
checkpoint o evidencia privada al repositorio ni imprimirlos en logs.

Copia VPS: `/opt/manolo-platform/releases/credit-permission-20261106`.
`release.tar.gz` SHA-256
`3c5aacdd20192c1280a297e8c4ef30ca9c1d9e8cd61fba56887af4857bd1e1d9`,
comprobado antes y después de SCP. Bridge sin reinicio ni reconstrucción.

## Operación y rollback

El usuario debe pedir un nuevo resumen y confirmar mediante su nuevo botón.
No reutilizar el botón rechazado ni repetir la operación mediante scripts.

Para revertir únicamente el código, desde configuración validada:

```sh
npx wrangler@4.157.0 rollback a768ba36-12c1-4024-8b26-11d7bda4df45
```

La reversión de código no revoca el permiso expresamente autorizado. No restaure
el checkpoint `issuing` rechazado ni borre estados para un rollback. Revisar
operaciones inciertas y verificar salud/configuración antes y después.
