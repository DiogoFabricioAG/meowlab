# 0006. Portal web app.meowlab.tech con cuentas propias vinculadas a WhatsApp

- Estado: aceptado (fase 1 implementada, sin desplegar)
- Fecha: 2026-11-11
- Responsable: MeowLab

## Contexto

Los usuarios de Manolo sólo ven sus comprobantes por WhatsApp o en la pantalla
administrativa de FacturaYa (`facturas.meowlab.tech`), que es por empresa y no
conoce los roles de MeowLab. Se quiere un portal donde una persona vea los datos
de sus roles: primero facturación (`enterprise-advisor`) y después los demás.

Hoy la identidad de una persona es su contacto de WhatsApp en PostgreSQL, que es
la autoridad para roles, permisos y empresas de FacturaYa. Los tokens de
FacturaYa por empresa viven en el VPS y sólo el bridge los usa.

## Decisión

1. **Aplicación propia.** `apps/meowlab-app` se despliega como un Worker de
   Cloudflare con recursos estáticos en `app.meowlab.tech`. Tiene su propio
   `wrangler.jsonc`, sus secretos y su D1 (`meowlab-app`); no comparte la D1 ni
   el despliegue de Manolo ni de la landing.

   Cloudflare es una elección de simplicidad, no un destino. Cuando el portal
   crezca se muda al VPS para tener más control, y el código ya está separado
   para eso: la API es Hono y la autenticación Better Auth, ambos corren en Node;
   `server/worker.ts` es la única entrada específica de Cloudflare y la base de
   datos es lo único que cambia (D1 hoy, un pool de PostgreSQL en el VPS, con el
   mismo esquema de Better Auth generado para ese dialecto). La interfaz es un
   sitio estático (React + Vite) que también puede servir Caddy.
2. **Cuentas con Better Auth.** Correo y contraseña, más inicio de sesión con
   Google. Usuarios, sesiones y cuentas OAuth viven en la D1 del portal. Cookies
   `HttpOnly`, `Secure` y `SameSite=Lax`, limitadas a `app.meowlab.tech`.
3. **Vinculación del número con un código por WhatsApp (OTP).** Revisado el
   2026-11-11 a pedido del operador: reemplaza el comando entrante `MEOWLAB VINCULAR`
   por el flujo habitual de verificación, como el de Mercado Pago. Una cuenta sólo
   ve datos después de demostrar que controla el número:
   - el usuario escribe su número en el portal; el portal lo envía al bridge;
   - el bridge genera un código de 6 dígitos y guarda sólo su hash en PostgreSQL;
     vence a los 10 minutos y admite 5 intentos;
   - el bridge pide a Manolo, por una ruta firmada propia, enviar el código con la
     plantilla de **autenticación** aprobada por Meta (botón «Copiar código»).
     Manolo es quien tiene el token de Meta; el portal nunca ve el código ni el token;
   - el usuario pega el código en el portal y el bridge registra el vínculo
     cuenta ↔ número en PostgreSQL.

   Sólo se envían códigos a números que ya hablaron con Manolo; para cualquier otro
   número el portal responde lo mismo, sin enviar nada ni revelar si es cliente.
   Límites contra el abuso de envíos (cada mensaje tiene costo): 3 códigos por número
   y 5 por cuenta cada hora, y 60 segundos entre reenvíos. Un número sólo puede estar
   vinculado a una cuenta; verificarlo desde otra cuenta lo mueve a esa cuenta.

   Respaldo previsto, no implementado: si la plantilla no está disponible, el portal
   ofrece un botón «Abrir WhatsApp» con el mensaje ya escrito para enviárselo a
   Manolo, que lo consume antes de los roles como `RADAR ACTIVAR`.
4. **Autorización en el bridge.** El portal llama al bridge con HMAC, timestamp y
   request ID, con un secreto distinto del de Manolo. Envía sólo el id de la
   cuenta autenticada; el bridge resuelve contacto → roles → empresas FacturaYa
   permitidas y recién entonces llama a FacturaYa con el token de esa empresa. El
   portal nunca recibe tokens de FacturaYa ni consulta PostgreSQL directamente.
5. **Módulos por rol.** El portal muestra un módulo por cada rol del contacto. La
   primera versión sólo tiene Facturación y es de sólo lectura:
   - comprobantes (facturas, boletas y notas) con fecha, cliente, total y estado
     SUNAT, filtrables por fecha y tipo;
   - descargas de PDF, XML y CDR, transmitidas por el bridge;
   - resumen mensual: total, IGV y cantidad de comprobantes;
   - guías de remisión con su estado y archivos.

## Consecuencias

- FacturaYa necesita endpoints de lectura que hoy no tiene: listado paginado de
  comprobantes emitidos y resumen mensual. El listado de guías y las descargas
  XML/CDR ya existen. El PDF de la guía hoy lo genera el Worker de Manolo; el
  portal lo ofrecerá cuando exista una fuente común.
- El bridge suma rutas firmadas para el portal: crear y confirmar vínculos, y
  consultas de facturación con autorización por cuenta.
- Manolo suma una ruta interna firmada para enviar el código con la plantilla de
  autenticación; no pasa por la IA ni por los roles. El operador crea y hace aprobar
  la plantilla en WhatsApp Manager.
- Recuperar contraseña y verificar correo requieren un proveedor de correo; está
  pendiente. Mientras el correo no se verifique, el inicio con Google no se enlaza
  a una cuenta con contraseña del mismo correo (evita el secuestro previo de cuentas).
- La apariencia sigue a meowlab.tech: colores, tipografías Blinker y Actor,
  botones y tarjetas de la landing.
- El cliente OAuth de Google lo crea el operador en Google Cloud; su secreto va a
  Cloudflare Secrets.
- Las solicitudes de activación del onboarding de `cat` podrán mostrarse en el
  portal más adelante.

## Fases

1. Esqueleto de `apps/meowlab-app`, Better Auth sobre D1, Google y correo, y
   despliegue en `app.meowlab.tech` sin datos todavía.
2. Vinculación: migración PostgreSQL de vínculos y códigos, ruta firmada del
   bridge para el portal, ruta de Manolo que envía la plantilla de autenticación y
   pantalla de verificación en el portal.
3. Lectura de facturación: endpoints de FacturaYa y rutas autorizadas del bridge.
4. Pantallas de comprobantes, descargas, resumen mensual y guías.

Cada fase se entrega desde un commit publicado, con acta, según la regla crítica
de `AGENTS.md`.
