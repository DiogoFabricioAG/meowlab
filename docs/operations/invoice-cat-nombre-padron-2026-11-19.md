# Despliegue: Invoice Cat usa siempre el nombre del padrón (y PDF de FacturaYa)

- **Fecha:** 19/11/2026.
- **Autorización:** el operador lo pidió («Sí, despliega») tras fusionar meowlab#20 y facturaya-ai#1.

## Motivo

La factura F001-00000027 de CREACIONES J&D salió con el nombre del cliente escrito a mano. El RUC del cliente empieza con 10. Hubo dos causas:

- Invoice Cat solo consultaba el RUC cuando no había nombre.
- El PDF ponía «Razón social» a una persona natural.

## Qué se publicó

1. **Worker** `whatsapp-webhook-meta-production`.
   - Versión: `34da882d-d230-4ec1-a7f0-81ab30d1d5c0`. La anterior era `432dddd4-7fa3-4623-95b9-4d6270673eae`.
   - Origen: commit publicado `0151f` de `main` (meowlab#20), desplegado desde un worktree limpio y sin `.dev.vars`.
   - Qué cambia en Invoice Cat:
     - Consulta el RUC en las facturas y el DNI en las boletas aunque venga un nombre, y usa el del padrón.
     - Si el nombre escrito era distinto, avisa.
     - No repite la consulta en cada turno.
2. **FacturaYa**, release `nombres-padron-pdf-20261119T055023Z`.
   - Origen: commit `74972b0ae0099199fe45e32543fb257eca3fe1a0` de `main` en facturaya-ai (PR #1).
   - Qué cambia en el PDF:
     - La etiqueta del cliente es «Nombre» o «Razón social», según el documento.
     - Si la empresa tiene un nombre comercial distinto del legal, se muestran los dos.
   - El acta propia está en el repo de FacturaYa: `docs/deployment-2026-11-19-nombres-padron-pdf.md`.

## Verificación

- **Worker:** `/health` responde 200 en la versión nueva.
- **FacturaYa (`cutover.sh`):**
  - Salud interna y pública: 200.
  - `invoice-drafts` e `issued-documents` sin token: 401.
  - PDFs internos sin token: 401.
- **Factura real F001-00000027**, generada en memoria con el código nuevo, sin guardarla ni enviarla:
  - La etiqueta del cliente es «Nombre».
  - Ya no aparece «Razón social».

## Pendiente

- **Corregir los datos de J&D en FacturaYa.** Su `legal_name` guarda el nombre comercial, distinto del nombre del padrón, y eso va al XML como razón social. Requiere una autorización aparte.
- **Emitir una factura de prueba** con un nombre escrito a mano y comprobar el aviso y el nombre del padrón.

## Rollback

- **Worker:**

  ```sh
  npx wrangler rollback 432dddd4-7fa3-4623-95b9-4d6270673eae --env production
  ```

- **FacturaYa:**

  ```sh
  bash /opt/facturaya-ai/backups/releases/nombres-padron-pdf-20261119T055023Z/rollback.sh
  ```
