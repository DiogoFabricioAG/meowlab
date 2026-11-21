# Cambio de configuración: Mercado Pago pasa de prueba a producción en el portal

Fecha: 20/11/2026, 22:25 en Lima (03:25 UTC del 21/11). Lo pidió el operador («Sí, pásalo»), después de cargar él mismo las credenciales de producción en el VPS.

**No es un despliegue de código.** El contenedor `meowlab-app` se recreó con la misma imagen que ya corría, `meowlab-app:887bba550816`. Solo cambian dos secretos de Docker y una variable de entorno. La regla crítica de git sigue pendiente para esa imagen: el commit `887bb` todavía vive en la rama local de Tender Cat (tarea `tender-ramas-sin-publicar-20261120`).

## Qué cambió

1. **Credenciales:** `secrets/mercadopago_access_token` y `secrets/mercadopago_webhook_secret`, en `/opt/meowlab-app/deploy`, pasan a las de producción.
   - Las cargó el operador con `read -s`; sus valores no se mostraron.
   - Las de prueba quedaron como `*.prueba`, con modo 600.
   - Las nuevas tienen modo 644, el mismo de antes, porque el contenedor corre como `node`, uid 1000.
2. **Modo:** en `.env`, `MERCADOPAGO_TEST_MODE` pasa de `true` a `false`.
3. **Suscripción de prueba:** en la base `meowlab_app`, la suscripción `920aa54c…` pasa de `authorized` a `cancelled`.
   - Era la de prueba del 11/11: Invoice Cat, S/ 39, a nivel de cuenta, sin `tenant_id`.
   - Con el token real, Mercado Pago no la reconoce, y además bloqueaba una compra nueva de esa cuenta.
   - No había activado ningún gato: el pago solo activa Sales Cat.
   - El pago de prueba sigue en `billing_payments` como historial.

## Antes del cambio

- **Respaldo:** de `.env`, `compose.yml`, `compose.tender.yml` y los dos secretos de prueba, en `/opt/meowlab-app/backups/mp-prod-20261121T032443Z`.
- **Token nuevo:** se validó con `GET /users/me`, de solo lectura. Resultado: `site_id` MPE, `country_id` PE, `user_type` normal, sin la etiqueta `test_user`, `site_status` active.
- **Diferencia con la prueba:** tanto el token como la clave del webhook son distintos de los de prueba.

## Procedimiento

```sh
cd /opt/meowlab-app/deploy
sudo sed -i 's/^MERCADOPAGO_TEST_MODE=true$/MERCADOPAGO_TEST_MODE=false/' .env
sudo docker compose up -d --no-deps app
```

## Verificación

- **Contenedor:** `meowlab-app` está `healthy`, con la imagen `meowlab-app:887bba550816` y `MERCADOPAGO_TEST_MODE=false`. El token se puede leer desde el contenedor.
- **Rutas:** `https://app.meowlab.tech/`, `/api/health` y `/agentes` responden HTTP 200.
- **Webhook:** `POST /api/webhooks/mercadopago` sin firma responde 401 `{"outcome":"invalid"}`.
- **Pendiente:**
  - una compra real hecha por el operador, para confirmar que llega el webhook firmado de producción y que se acredita el mes;
  - el webhook de producción se configuró en el panel con `https://app.meowlab.tech/api/webhooks/mercadopago`.

## Volver a modo prueba

```sh
cd /opt/meowlab-app/deploy
cp secrets/mercadopago_access_token.prueba secrets/mercadopago_access_token
cp secrets/mercadopago_webhook_secret.prueba secrets/mercadopago_webhook_secret
chmod 644 secrets/mercadopago_access_token secrets/mercadopago_webhook_secret
sudo sed -i 's/^MERCADOPAGO_TEST_MODE=false$/MERCADOPAGO_TEST_MODE=true/' .env
sudo docker compose up -d --no-deps app
```

Las suscripciones reales creadas en producción no se pueden consultar con el token de prueba. Antes de volver a prueba, hay que cancelarlas en Mercado Pago.
