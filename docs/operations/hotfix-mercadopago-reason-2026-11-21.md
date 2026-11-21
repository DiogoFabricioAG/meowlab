# Corrección urgente: suscripción con más de dos gatos rechazada por Mercado Pago

Fecha: 21/11/2026, cerca de las 02:30 en Lima. El operador lo reportó: «No pudimos abrir Mercado Pago» al suscribirse. Autorizó el arreglo y su despliegue («Arréglalo tú ahora»).

- **Causa:** el portal registró `{"event":"billing_subscription_failed","reason":"mercadopago_400_reason has more than 60 characters"}`.
  - La descripción del preapproval juntaba los nombres de todos los gatos elegidos («MeowLab · Invoice Cat + … + Collections Cat»).
  - Mercado Pago acepta como máximo 60 caracteres.
  - Pasa desde que se pueden comprar los seis gatos (PR #49).
- **Corrección:** PR #78, commit `d2eedd05321dffa4b06191b17ea71db98dc7e6f4`.
  - `subscriptionReason()` lista los gatos mientras quepan en 60 caracteres. Si no, usa «MeowLab · N gatos».
  - Hay una prueba de 1 a 6 gatos.
- **Arreglo de entorno local, en el mismo PR:** `apps/meowlab-app/postcss.config.mjs` vacío.
  - Con Astro 7, la landing tiene un `postcss.config.mjs` en la raíz. Vite lo encontraba al compilar el portal en local y fallaba por `autoprefixer`.
  - En Docker no afectaba.
- **Pruebas del portal:** 84 de 84, sin errores de tipos y con el build OK.

## Despliegue

- **Solo el portal y el servicio de Tender:** `MEOWLAB_APP_TAG` pasa de `5b927b7798d2` a `d2eedd05321d`. Sin cambios en el bridge, el Worker ni las migraciones.
- **Verificación:**
  - los dos contenedores quedan `healthy`;
  - `MERCADOPAGO_TEST_MODE=false`;
  - `/`, `/api/health` y `/plan` responden 200;
  - el bundle en ejecución incluye la descripción nueva.
- **Pendiente:** confirmar que el operador puede suscribirse con varios gatos. No se creó ninguna suscripción de prueba.
- **Rollback:**

  ```sh
  bash /opt/manolo-platform/releases/portal-d2eedd05321d/rollback.sh
  ```
