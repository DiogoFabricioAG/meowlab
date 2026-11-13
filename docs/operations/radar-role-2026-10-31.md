# Publicación del rol RADAR — 2026-10-31

Solicitud: incorporar licitaciones al sistema existente de roles/TUI. La
asignación a contactos queda a cargo del fundador. No se solicitaron ni usaron
números personales para el alta del rol.

## Estado publicado

- Worker: `whatsapp-webhook-meta-production`.
- Versión anterior: `bf74500a-59ea-4820-be93-aa3c89adb780`.
- Versión nueva: `b406aab4-86cc-4dfd-a8cd-4d0a5edb9fe6`.
- Catálogo VPS: `radar`, «RADAR · Licitaciones», activo y asignable.
- Migración aplicada: `infra/postgres/migrations/008-radar-role.sql`.
- Asignaciones de contactos: huella anterior/posterior idéntica.
- Bindings, variables, compatibilidad y ráfagas: conservados y comparados con
  los metadatos del despliegue descargado. No se leyeron valores de secretos.

## Preparación y pruebas

`tools/prepare-radar-role-release.mjs` parte de la fuente realmente desplegada,
verifica el baseline y genera un parche reversible. Añade el handler al registro,
el adaptador al contexto y el parser de controles; el resto se reconstruye
idéntico al invertir los cambios. Snapshot/paquete privados bajo
`backups/radar-role-20261031/`, fuera de Git. No se desplegaron los cambios
ajenos que conserva el árbol local.

Suite local: 220 pruebas en 27 archivos con `--maxWorkers=1`. Una pasada en
paralelo falló en la aserción temporal del ACK de ráfagas (el temporizador de
tres segundos había ejecutado el lote antes de la aserción); la suite serial
completa pasó. No se modificó el runtime de ráfagas para esta entrega.

Pruebas del paquete aislado: 17 correctas, incluidas firma Meta simulada,
handler asignado por contacto, ausencia de FacturaYa, consumo de comandos,
deduplicación y vínculo/ventana/revocación. Typecheck correcto y dry-run con
Wrangler 4.156.0. La migración se probó dentro de una transacción con rollback
confirmado antes de aplicarla.

Comprobaciones posteriores: bundle remoto contiene el handler y adaptador;
bindings idénticos; `/health` 200, estado sin token 401 y webhook sin firma 401.
No se fabricó un webhook firmado en producción ni se envió WhatsApp real.
La respuesta real queda por comprobar tras asignar el rol desde la TUI.

## Uso

Desde `apps/manolo-whatsapp-worker`, cerrar y abrir `npm run users:tui`, buscar el
contacto y seleccionar «RADAR · Licitaciones». En WhatsApp, `RADAR AYUDA` muestra
el alcance; `RADAR ESTADO` consulta la vinculación real. Vincular y revocar alertas
no cambia el rol; se mantiene la operación del escritorio desde Ajustes.

## Incidente comunicado

Se reportó una respuesta de FacturaYa después de intentar vincular. La versión
descargada conservaba la intercepción y D1 registraba una vinculación consumida,
pero esa evidencia no identifica el intento concreto del usuario. No se atribuye
una causa definitiva ni se afirma una prueba real de respuesta. La entrega añade
el rol que faltaba y endurece controles con espacios/saltos y payload inválido.
