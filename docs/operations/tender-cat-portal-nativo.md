# Tender Cat dentro del portal

El portal sirve las pantallas en `/agentes/licitaciones`. Cada operación pasa por `/api/companies/{empresa}/tender/…`. El servidor comprueba la sesión y la pertenencia y llama al servicio interno con la empresa verificada. El piloto tiene una correspondencia explícita entre empresa y cuenta documental.

## Configuración del piloto

El 20 de noviembre de 2026 se desplegó en producción el commit privado `a1f7966a1c9a474a8daf82385f4d5f381be83e42` de `meowlaboratoy/meowlab-platform`. El servicio documental abrió el histórico, las guardadas y los intereses de la empresa piloto desde su PostgreSQL. Las consultas de prueba fueron de lectura. Una petición interna sin token recibió 401 y una petición con otra empresa recibió 403.

El portal y el servicio documental quedaron saludables. La ruta pública y `/healthz` devolvieron 200. El SHA-256 del JavaScript publicado (`/assets/index-ClTQCnXR.js`) coincidió con el de la imagen del portal. El API público de expedientes exigió sesión (401). El cambio conservó el procesamiento de WhatsApp existente. El recorrido con un participante autorizado está pendiente.

La reversión de este despliegue está en `/opt/manolo-platform/releases/tender-native-a1f7966a1c9a/rollback.sh`. Restaura la imagen anterior del portal `1fde2b38cfa7` y detiene el servicio nativo.

## Búsqueda automática de precios y alternativas

El portal y el servicio se desplegaron desde el commit privado `19df5ac88224`. La recepción y preparación de bases mantiene su consumidor existente. El servicio de Tender Cat habilita su propio proceso de búsqueda de precios con `TENDER_MARKET_ENABLED=1`.

La API del piloto devolvió el estado de cotización y PostgreSQL registró la ejecución de una búsqueda. El portal publicó `/assets/index-BsVu9Gx1.js`. El recurso coincide con la imagen desplegada y se verificaron los 14 archivos de imagen públicos. Ambos servicios quedaron saludables. Queda la aceptación de un PDF nuevo por WhatsApp.

El script de reversión está en `/opt/manolo-platform/releases/tender-prices-19df5ac88224/rollback.sh` y recupera la configuración previa y sus imágenes.

Construir desde el mismo commit la imagen `meowlab-app:<commit>` con el contexto `apps/meowlab-app` y la imagen `meowlab-tender-service:<commit>` con `apps/tender-service`. Usar las redes y la base PostgreSQL existentes del piloto para conservar expedientes, archivos y versiones. El servicio tiene acceso privado a la base documental. El navegador solo necesita el dominio del portal.

En el directorio de despliegue crear `secrets/tender_service_token` con un secreto aleatorio del servidor y permisos de lectura restringidos. Definir `MEOWLAB_APP_TAG`, `TENDER_DB_NETWORK` (nombre real de la red Docker del PostgreSQL documental) y `TENDER_ENV_FILE` (ruta absoluta a un archivo privado con permisos 600). Este último contiene `DATABASE_URL`, `RADAR_PORTAL_COMPANY_ID`, `RADAR_WEB_ACCOUNT`, `RADAR_MEOWLAB_TOKEN` y las credenciales del proveedor IA del piloto. Mantener un solo consumidor de cada cola. El override deja el procesamiento y el descubrimiento a los workers actuales.

Desde el directorio de despliegue, validar y aplicar ambas definiciones juntas.

```sh
docker compose -f compose.yml -f compose.tender.yml config --quiet
docker compose -f compose.yml -f compose.tender.yml up -d --no-deps tender-service
docker compose -f compose.yml -f compose.tender.yml ps tender-service
docker compose -f compose.yml -f compose.tender.yml up -d --no-deps app
```

Verificar la salud de la API y el portal. Con un participante autorizado, abrir una guardada anterior, descargar una fuente y volver al listado. La prueba de escritura se hace con un expediente de ensayo. Para revertir, restaurar la etiqueta anterior del portal y recrear únicamente `app` con la definición anterior. Detener el servicio interno después de comprobar la reversión. Conservar la base y sus volúmenes.
