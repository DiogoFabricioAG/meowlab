# PDF de la guía de remisión — entrega 2026-11-06

## Estado

**Publicado** en el Worker `c2070081-e27d-4d2b-a613-d2941c9aaa61` al 100%
(base anterior `5a7c916e-6210-4caf-838f-e2d596e16bc3`). Fuentes en el commit
`673bb3d` de `origin/feat/gre-pdf-formato`. Sin migraciones, secretos, cambios de
cron, bindings ni bridge.

## Qué cambia para el usuario

El rol de facturas envía un PDF A4 que replica
[`Guia_Remision_Plantilla_M1_L_2026.docx`](../apps/templates/Guia_Remision_Plantilla_M1_L_2026.docx):

- con la revisión de la guía, antes del botón «Confirmar guía» (número `T001 - BORRADOR`);
- tras emitir, con serie y correlativo cuando FacturaYa los devuelve;
- a pedido, con el botón «PDF de la guía» o escribiendo «PDF».

No se imprime una guía rechazada ni con envío incierto. Si Browser Run o la subida
a Meta fallan, Manolo lo dice y la confirmación sigue disponible. El PDF es un
formato de trabajo sin QR: no sustituye la representación impresa de la GRE.
Detalle funcional en [manolo-despatch.md](../apps/manolo-despatch.md).

## Procedimiento (excepción a la regla de git)

Publicación por injerto, como las entregas anteriores, autorizada por el operador
como excepción registrada en `AGENTS.md`:

1. `node tools/snapshot-gre-pdf-release.mjs` — snapshot de solo lectura de
   `5a7c916e` y del bridge (imagen `sha256:29c6582f…`, healthy).
2. `node tools/verify-gre-pdf-worker.mjs before` — línea base correcta.
3. `node tools/prepare-gre-pdf-release.mjs` — anclaje único
   `new EnterpriseAdvisorRoleHandler()` → `new GrePdfEnterpriseAdvisorRoleHandler()`,
   inverso verificado; 13 fuentes, todas idénticas al commit publicado.
4. Pruebas del release sobre el runtime injertado: 451 pruebas / 26 archivos OK.
5. `wrangler deploy --dry-run`: 21 bindings idénticos a `5a7c916e`; 4.943,94 KiB
   (gzip 951,66 KiB).
6. Push de `feat/gre-pdf-formato` (cuenta `DiogoFabricioAG`, solo para ese push) y
   después `wrangler deploy --outdir ../worker-upload`.
7. `node tools/verify-gre-pdf-worker.mjs after c2070081-…` — bindings, compatibilidad
   y cron preservados, `/health` 200, bridge sin cambios, código activo idéntico al
   dry-run (`sha256:751498b0…`).

El bundle base de producción sigue fuera de git (`backups/gre-pdf-20261106/`). El
runtime de producción no inyecta `renderPdf`; el rol usa el binding `BROWSER` de
`env` como respaldo.

## Pendiente

- Prueba desde un WhatsApp autorizado: pedir el resumen de una guía y comprobar el
  PDF (fuente sustituta de Aptos en Browser Run) y la ausencia de
  `whatsapp_pdf_render_failed` / `whatsapp_gre_pdf_failed` en los logs.
- Reconciliar `src/` con producción para volver a publicar sin injertos.

## Rollback

```sh
npx wrangler rollback 5a7c916e-6210-4caf-838f-e2d596e16bc3 --name whatsapp-webhook-meta-production
```

No hay estado nuevo que revertir: el PDF no se persiste y el checkpoint de la guía
conserva el mismo formato.
