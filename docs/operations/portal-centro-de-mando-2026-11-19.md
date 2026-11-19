# Despliegue del portal: Inicio como centro de mando y barra lateral clara

- **Fecha:** 19/11/2026.
- **Autorización:** el operador lo pidió («Despliégalo para ver») tras fusionar meowlab#24.
- **Commit publicado:** `4b35a5e1608fdf528916ed50307a0dc37cf4c852` (`main`, «Portal: Inicio como centro de mando y barra lateral clara (#24)»).
- **Imagen:** `meowlab-app:4b35a5e1608f` (antes `meowlab-app:8a6aee5f008f`). Se construyó en el VPS a partir del `git archive` de `apps/meowlab-app`.

## Qué cambia

El cambio es solo de interfaz. No toca la API, las migraciones ni los datos.

- **Barra lateral clara:**
  - Inicio muestra el contador de pendientes.
  - La lista «Tus gatos» indica el estado de cada uno.
- **Inicio:**
  - La semana en cuatro cifras, cada una con su comparación.
  - «Para atender».
  - «Tus gatos hoy».

Todo sale del resumen semanal existente.

## Verificación

- **Antes del cambio:** el bundle de la imagen nueva contiene «Para atender» y «Tus gatos hoy».
- **Despliegue:** `MEOWLAB_APP_TAG=4b35a5e1608f docker compose up -d`. El contenedor quedó `healthy`, sin errores en los registros de los primeros dos minutos.
- **Rutas:**
  - `https://app.meowlab.tech/`, `/inicio` y `/agentes` responden 200.
  - `/api/companies` sin sesión responde 401.
- **Pendiente:** que el operador revise el Inicio con su cuenta real de CREACIONES J&D.

## Rollback

```sh
cd /opt/meowlab-app/deploy && MEOWLAB_APP_TAG=8a6aee5f008f docker compose up -d
```
