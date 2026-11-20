# Tender Cat dentro del portal

El portal sirve las pantallas en `/agentes/licitaciones`. Cada operación pasa por `/api/companies/{empresa}/tender/…`. El servidor comprueba la sesión y la pertenencia y llama al servicio interno con la empresa verificada. El piloto tiene una correspondencia explícita entre empresa y cuenta documental.

## Configuración del piloto

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
