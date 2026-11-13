# Manolo: navegación por intención publicada — 2026-11-06

Publicación autorizada por Diogo. Worker
`a768ba36-12c1-4024-8b26-11d7bda4df45` al 100 %, sobre
`4ceeaa93-b19e-41b5-b864-bdeb046a2f42`. Bridge
`manolo-platform-bridge:fiscal-20261105`, imagen `84ee1c65`, conservado y saludable.
Acceso operativo verificado mediante `ssh meowlab`.

## Comportamiento activo

- Decisions API clasifica el texto actual antes de responder según el comprobante
  anterior; saludo/ambigüedad presenta Generar Factura, Generar Boleta y Otras opciones.
- Un pedido claro inicia directamente el flujo y conserva los datos aportados,
  incluso cuando se necesita seleccionar empresa.
- Otras opciones consulta borradores paginados, prepara anulación, abre GRE
  cuando está disponible o cambia empresa. Anular requiere resumen entregado y
  botón vinculado a revisión/comprobante; un texto no autoriza la operación.
- Tras entregar el PDF o terminar otra gestión, Sí vuelve al menú y No cierra
  cordialmente. Los botones antiguos/de otro contacto no reinician otra tarea.
- Las operaciones inciertas conservan referencias, bloquean reenvíos y cambios
  de empresa. GRE pendiente no se anuncia terminada. La habilitación fiscal real
  de GRE en FacturaYa sigue siendo una dependencia ajena a esta publicación.

## Preparación y evidencia

`tools/snapshot-intent-release.mjs`, `tools/prepare-intent-release.mjs` y
`tools/verify-intent-worker.mjs` son relativos al paquete Manolo. Artefactos
privados ignorados por Git en `backups/intent-20261106/`. El generador exige la
base activa esperada y prueba la reversibilidad de tres sustituciones: handler
empresarial, adaptador OpenAI y guardia de confirmación de nota de crédito en
ráfagas. El resto del entrypoint conserva sus bytes; no se reconstruye desde el
árbol de trabajo con cambios pendientes de otros dominios.

- 330 pruebas del paquete aislado, 21 archivos, correctas; incluyen regresión
  RADAR, contratos privados, ráfagas, pago, GRE y navegación empresarial.
  Sólo los tests RADAR fijan su reloj dentro del horario permitido.
- `npm.cmd run typecheck` y dry-run Wrangler 4.157.0 correctos.
- Publicación con la misma configuración y `--keep-vars`; sin migraciones,
  cambios de secretos, reinicios del bridge ni operaciones fiscales reales.
- Verificación posterior: bindings, nombres de secretos, variables,
  compatibilidad, observabilidad, cron `*/15 * * * *` y ráfagas `true` preservados.
- Worker `/health` 200. Código activo idéntico al dry-run, SHA-256
  `df61d04730804fa044ed245f992a53131fcf3aa2c18c3aa6ad28c541a59e5336`.
- Smoke del bridge a través de Caddy: salud, ruta RADAR, HMAC, permisos y replay
  correctos. Cinco operaciones con actor sintético inexistente rechazadas;
  cero llamadas de proveedor, consultas de identidad o emisiones reales.

Paquete copiado por SCP y extraído en
`/opt/manolo-platform/releases/intent-20261106`. SHA-256 de `release.tar.gz`:
`7206115e9a567e4cf267207126dc8a519fc95401fb038064cf69af80b39b5265`,
comprobado localmente y en VPS. Contiene fuentes aisladas, pruebas, manifiesto,
configuración y artefacto dry-run; no contiene credenciales ni datos de clientes.
Cloudflare se publicó desde el entorno local autenticado: la VPS conserva la
entrega y su evidencia; el código conversacional se ejecuta en el Worker.

## Rollback

Antes de volver a la versión anterior, revisar las operaciones pendientes y
conservar especialmente las referencias de notas de crédito inciertas: la
versión anterior no interpreta el nuevo modo conversacional `credit_note`.
No borrar checkpoints, bandejas DO ni bases para revertir una publicación.

Desde una configuración aislada validada y con sesión Wrangler:

```sh
npx wrangler@4.157.0 rollback 4ceeaa93-b19e-41b5-b864-bdeb046a2f42
```

El bridge no cambió y no necesita rollback. Verificar salud, configuración y
ráfagas después de cualquier reversión. Para otra publicación volver a
inventariar producción; no reutilizar el generador con una base distinta.
