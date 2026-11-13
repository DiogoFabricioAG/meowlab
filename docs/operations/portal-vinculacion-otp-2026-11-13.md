# Vinculación del WhatsApp del portal con código (fase 2 del ADR-0006)

Fecha: 13/11/2026 (01:30–02:40 UTC). Autorizado por el operador al aprobarse la
plantilla («Sí, cuando se apruebe»; «Ya cargo el codigo OTP, podemos darle caña»).
Commit publicado `657b3c4e4428f905571fdacb11590fccb6d41a25` (rama `feat/manolo-kapso`).

## Qué se desplegó

- **Plantilla** `codigo_otp_meowlab` (Autenticación, Spanish (PER), «Copiar código»),
  activa en WhatsApp Manager.
- **Worker de Manolo** `c1147d37-a96d-4d64-98d1-5754dd8bbfb4` (100 %), antes
  `dd113051`. Agrega la ruta firmada `/v1/internal/whatsapp-auth-code` y la integración
  con Kapso (ADR-0009), que queda inactiva: `KAPSO_PHONE_NUMBER_IDS` está vacía.
  Pruebas en la copia del commit: 608/610; los 2 fallos son las pruebas de RADAR que
  dependen de la hora (`radar-tests-clock-20261112`).
- **Secretos** (valores no mostrados): `AUTH_CODE_HMAC_SECRET` generado en el VPS y
  cargado en el Worker; `portal_bridge_hmac_secret` del portal copiado al bridge
  (sha256 igual en ambos lados); ambos `ubuntu:ubuntu 600` en
  `/opt/manolo-platform/infra/vps/secrets`.
- **PostgreSQL:** migración `011-portal-whatsapp-links.sql` aplicada
  (`portal_link_challenges`, `portal_whatsapp_links`).
- **Bridge:** release `/opt/manolo-platform/releases/portal-otp-20261113T014221Z`, imagen
  construida desde `git -c core.autocrlf=false archive` del commit; `compose.yml` con
  `MANOLO_WORKER_URL` y los dos secretos. Cutover con rollback automático: contenedor
  `healthy` con la imagen nueva, consulta firmada `status` → `not_linked`, conteos
  1740 mensajes · 258 ventas · 725 solicitudes.
- El portal no se redesplegó: ya tenía la pantalla y el secreto, y la rama
  `feat/app-login-transition` de otro trabajo lo estaba actualizando.

## Prueba real

El operador vinculó su número desde app.meowlab.tech: código enviado (`delivery =
sent`, 02:38:36 UTC) y `portal_whatsapp_linked` a las 02:39:05 UTC; un vínculo en
`portal_whatsapp_links`. El rol del contacto (RADAR) no cambia.

## Rollback

```bash
bash /opt/manolo-platform/releases/portal-otp-20261113T014221Z/rollback.sh
npx wrangler rollback dd113051-d5d9-49e2-ace3-be29756a5e45 --name whatsapp-webhook-meta-production
```

Las tablas de la migración 011 y los secretos pueden quedarse: las versiones anteriores
no los usan.

## Pendientes

- Aviso por WhatsApp al vincular un número (hoy no se envía nada): útil para que el
  dueño se entere si alguien vincula su número; fuera de la ventana de 24 h requiere
  plantilla.
- Respaldo con mensaje prellenado (`app-portal-link-fallback-20261111`).
- Fase 3: datos de facturación en el portal.
