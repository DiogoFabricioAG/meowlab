# Estado del proyecto

Fecha de corte: **2026-08-28**.

Este documento resume lo comprobado en el repositorio. No sustituye una consulta
al estado vivo de Cloudflare o del VPS cuando una operación dependa de ellos.

## Repositorio

- Repositorio: `meowlab`.
- Rama local: `main`, alineada con `origin/main` antes de esta documentación.
- Commit base observado: `7c5a5`.
- La landing Astro ya estaba versionada.
- La incorporación de `apps/manolo-whatsapp-worker`, junto con los cambios de
  `README.md` y `.gitignore`, está localmente sin commit. Debe conservarse.
- El proyecto original en `D:\Proyectos2026\webhook meta` continúa como copia
  temporal; no se ha autorizado su eliminación.

## Aplicaciones presentes

### Landing MeowLab

- Astro 5 con salida estática y Tailwind CSS.
- Rutas actuales: `/`, `/agentes`, `/contacto`, `/dedicado` y `/servicios`.
- No tiene backend propio en este repositorio.
- La validación disponible es `pnpm build`; aún no existen pruebas automatizadas
  ni lint configurado para la landing.

### Manolo WhatsApp Worker

- Cloudflare Worker TypeScript y bridge Node comparten paquete dentro de
  `apps/manolo-whatsapp-worker`.
- El Worker sigue siendo el único webhook registrado en Meta.
- Roles registrados: `cat`, `quotes`, `print-advisor`, `store-designer` y
  `enterprise-advisor`.
- Entradas transversales: texto, audio, imagen, documento e interacciones.
- Recursos Cloudflare configurados: D1 principal, D1 de Print System, R2 y
  Browser Run.
- Integraciones declaradas: Meta Graph API, Groq, endpoint compatible con
  OpenAI, FacturaYa, tienda virtual y bridge VPS.
- Los handlers y adaptadores de las funcionalidades financieras retiradas ya
  no forman parte del runtime. Las migraciones históricas que las originaron se
  conservan por compatibilidad de despliegue.

## Estado del runtime

El runtime todavía es híbrido:

| Responsabilidad | Estado actual |
| --- | --- |
| Webhook, firma Meta, normalización de media y respuesta | Worker |
| Lookup inicial de tenant | D1 |
| Conversaciones, historial y deduplicación principal | D1 |
| Estados de roles y cotizaciones | D1 |
| Resolución administrativa de roles | PostgreSQL VPS, con fallback D1 |
| Espejo de mensajes | PostgreSQL VPS cuando `VPS_PLATFORM_SHADOW_ENABLED=true` |
| Print Advisor | Bridge VPS + PostgreSQL `print_system`; fallback D1 |
| Membresías, permisos y tokens FacturaYa | PostgreSQL VPS |
| Documentos temporales empresariales | R2 |
| PDF de cotizaciones | Browser Run |

En producción, la configuración versionada activa el bridge y la escritura en
sombra. Esto no significa que PostgreSQL ya sea la autoridad de conversaciones.

## VPS y migración

El último reporte versionado indica:

- PostgreSQL y el bridge Node estaban saludables.
- Se aplicó `005-platform-runtime.sql`.
- Se reconciliaron 566 mensajes entre D1 y PostgreSQL sin IDs de Meta
  duplicados.
- PostgreSQL contiene estructuras de sesión e idempotencia preparadas, pero el
  Worker todavía no lee desde ellas como runtime principal.
- FacturaYa multiempresa ya resuelve membresía, empresa activa, permisos,
  credenciales cifradas, idempotencia y auditoría en el VPS.
- Tienda virtual queda fuera de la migración actual, aunque su rol y adaptadores
  continúan en el Worker.

Consulta el reporte fechado en
[`deployment-2026-08-26.md`](../../apps/manolo-whatsapp-worker/docs/vps-migration/deployment-2026-08-26.md)
y el plan en
[`architecture-foundation.md`](../../apps/manolo-whatsapp-worker/docs/architecture-foundation.md).

## Validación conocida

La copia ubicada en `D:\meowlab` fue validada antes de crear estos documentos:

- landing: compilación Astro correcta;
- Worker: 22 archivos de prueba y 114 pruebas correctas;
- TypeScript: `npm run typecheck` correcto;
- bridge Node: `npm run build:node` correcto;
- bindings: `wrangler types --check` correcto;
- despliegue Worker en seco correcto;
- auditoría de dependencias de producción sin vulnerabilidades reportadas.

La versión de Worker desplegada desde esta ruta fue
`226ad034-dc7e-43a4-9e05-c2e0dda93c91`. Una comprobación operativa futura debe
consultar Cloudflare en vez de asumir que seguirá siendo la versión activa.

## Deuda y siguientes decisiones

1. Completar el contrato de runtime para leer sesiones y conversaciones desde
   PostgreSQL.
2. Ejecutar escritura en sombra con observabilidad y reconciliación continua.
3. Hacer el corte por tenant antes de retirar el fallback D1.
4. Definir CI por rutas para que landing y Worker se validen y desplieguen por
   separado.
5. Añadir lint y pruebas de interfaz a la landing.
6. Revisar la integración de tienda antes de incluirla nuevamente en la
   migración.
7. Hacer commit de la incorporación del Worker solo después de revisar el diff
   completo y confirmar que no contiene secretos ni artefactos.
