# 0018. App móvil Android: el portal empaquetado con Capacitor

- Estado: aceptado (2026-11-20). El operador eligió Capacitor («Sí, Capacitor»).
- Responsable: MeowLab
- Relacionado: ADR-0006 (portal app.meowlab.tech), ADR-0015 a ADR-0017 (avisos y aprobaciones
  de Collections, Reorder y Support Cat)

## Contexto

Los gatos trabajan en WhatsApp y la titular revisa y configura en el portal `app.meowlab.tech`.
En el celular, el portal solo se abre desde el navegador: no avisa cuando algo espera su OK, no
recibe fotos desde la galería y pide la contraseña cada vez que caduca la sesión.

El portal es React 19 con Vite y Tailwind (`apps/meowlab-app/web`). Compila a
`apps/meowlab-app/dist` y llama a su API con rutas relativas (`/api/...`). El servidor es Hono y
autentica con better-auth mediante cookies.

Opciones evaluadas:

| Opción | Esfuerzo | Por qué no, o por qué sí |
| --- | --- | --- |
| PWA instalada o TWA | Muy bajo | Sin notificaciones confiables en todos los Android ni funciones nativas; casi no suma frente a la web. |
| **Capacitor** | Bajo a medio | Reutiliza la interfaz del portal y suma push, compartir y huella con plugins nativos. |
| Expo o React Native | Alto | Obliga a reescribir toda la interfaz. Solo conviene si la app se separa mucho del portal. |
| Kotlin nativo | Muy alto | Otro lenguaje y otro equipo de trabajo. |

## Decisión

1. **Capacitor sobre el mismo código del portal.** La app vive en `apps/meowlab-mobile`:
   `capacitor.config.ts`, el proyecto `android/` y los recursos nativos. Su `webDir` es la
   compilación del portal. No se copia la interfaz: toda mejora del portal llega a la app.
2. **La interfaz va empaquetada dentro de la app**, no cargada desde una URL remota (`server.url`).
   - Capacitor recomienda `server.url` solo para recarga en vivo.
   - Una app que solo muestra una web arriesga el rechazo en Google Play.
   - Empaquetada, la app abre sin conexión y muestra un estado offline propio.
3. **La API se llama con un origen configurable.**
   - Todas las llamadas pasan por un único `apiFetch()` que antepone
     `import.meta.env.VITE_API_ORIGIN`: vacío en la web y `https://app.meowlab.tech` en la app.
   - Se reemplazan las 12 llamadas a `fetch("/api…")` y el cliente de better-auth (`baseURL`).
4. **Sesión con token en la app, cookies en la web.**
   - Dentro de la app las cookies de `app.meowlab.tech` son de terceros, porque la interfaz corre en
     `https://localhost`. Por eso la app usa el plugin `bearer` de better-auth: el token va en
     `Authorization`.
   - El token se guarda cifrado con el Keystore de Android, mediante un plugin de almacenamiento
     seguro. Nunca va en `localStorage`.
   - La web sigue con cookies `httpOnly`, sin cambios.
5. **CORS solo para el origen de la app.**
   - El servidor acepta `https://localhost`, el origen de Capacitor en Android, con
     `Authorization` y sin cookies.
   - Se agrega a `TRUSTED_ORIGINS` de better-auth.
   - La CSP de `_headers` no aplica dentro de la app; la app declara la suya en `index.html`.
6. **Funciones nativas por fases:**
   - **v1:** botón atrás de Android, enlaces externos (`wa.me`, PDF) fuera de la app, splash e
     ícono de MeowLab.
   - **v2:** notificaciones push con Firebase Cloud Messaging (FCM).
   - **v3:** compartir fotos hacia MeowLab y entrar con huella.
7. **Push desde el bridge.**
   - Los eventos que esperan a la titular nacen en el bridge del VPS:
     - captura de pago por validar (Collections);
     - pedido por aprobar (Reorder);
     - caso escalado o reclamo (Support).
   - El bridge envía con la API HTTP v1 de FCM, usando una cuenta de servicio guardada como Docker
     Secret.
   - Los tokens de dispositivo se guardan en PostgreSQL del portal, por usuario y empresa, con
     migración nueva.
   - El aviso por WhatsApp no cambia; push es un canal adicional y opcional.
8. **Identificador de la app:** `tech.meowlab.app`. **Nombre visible:** «MeowLab».
9. **Distribución:** Google Play con Play App Signing.
   - La clave de subida vive fuera del repo, en la máquina del operador, con respaldo.
   - El AAB se construye desde un commit publicado, igual que el resto de despliegues (regla
     crítica de git).

## Plan

### Fase 0: requisitos del operador (en paralelo, sin código)

- **Cuenta de Google Play Console** (US$ 25, pago único). Hay que decidir el tipo:
  - **Personal:** las cuentas personales nuevas exigen una prueba cerrada con al menos 12 testers
    durante 14 días antes de publicar en producción.
  - **Organización:** evita esa prueba, pero pide número D-U-N-S de la empresa. Es gratuito y puede
    tardar días o semanas.
- **Proyecto de Firebase** para FCM, a nombre de MeowLab.
- **Clave de subida** de Android, guardada fuera del repo con respaldo.

### Fase 1: la app abre el portal y se puede iniciar sesión

- `apiFetch()` y `VITE_API_ORIGIN` en el portal, sin cambiar el comportamiento web, con pruebas.
- Plugin `bearer` de better-auth, CORS para `https://localhost` y el origen en `TRUSTED_ORIGINS`.
- `apps/meowlab-mobile`:
  - Capacitor y proyecto `android/`;
  - ícono y splash con la marca;
  - botón atrás;
  - enlaces externos;
  - pantalla sin conexión.
- APK de depuración instalable en un celular de prueba (no el teléfono +51 951 307 245).
- **Despliegue del portal:** los cambios de servidor (CORS y `bearer`) requieren desplegarlo.
  Hoy el portal de producción sale de una rama de Tender Cat sin fusionar, así que primero hay que
  fusionarla.

### Fase 2: notificaciones push

- Registro del dispositivo: endpoint en el portal y migración `app_devices`.
- Envío FCM desde el bridge para los tres eventos de la decisión 7. Tocar el aviso abre la
  pantalla correspondiente del portal.
- Preferencia en Configuración para activar o desactivar los avisos por tipo.

### Fase 3: prueba cerrada y publicación

- AAB firmado desde un commit publicado.
- Ficha de Play:
  - textos;
  - capturas;
  - política de privacidad, que ya existe en `meowlab.tech/privacidad/`;
  - formulario de seguridad de datos.
- Prueba cerrada con los testers que pida el tipo de cuenta y, después, producción.

### Fase 4: compartir y huella

- Recibir una imagen desde la galería: la foto de la factura de un proveedor va a Stock Cat y la
  captura de un pago va a Collections Cat.
- Entrar con huella usando el token guardado.

## Consecuencias

- El portal se vuelve también la interfaz móvil: sus pantallas deben funcionar bien a 360–430 px,
  que ya es una regla vigente.
- Aparece un segundo modo de autenticación (token). Las pruebas del servidor deben cubrir que un
  token de un usuario no da acceso a empresas de otro, igual que las cookies.
- Cada versión de la app necesita un AAB firmado y una revisión de Google, de horas a días.
  - Los cambios de interfaz no llegan a la app hasta la siguiente versión.
  - Los cambios de API sí llegan al instante, así que la API debe seguir siendo compatible con la
    versión anterior de la app.
- iOS queda fuera por ahora. Capacitor lo permite más adelante con el mismo código, pero necesita
  una Mac y la cuenta de Apple (US$ 99 al año).
