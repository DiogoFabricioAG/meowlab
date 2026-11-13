# Presencia del equipo RADAR — 2026-11-05

## Estado

Preparado localmente, **no desplegado**. Base revisada
`158b52bc-e20a-4a8f-ae31-92e64f3fdbef`. Paquete aislado en
`apps/manolo-whatsapp-worker/backups/radar-presence-20261105/release`, generado
por `tools/prepare-radar-presence-release.mjs`. El escritorio debe actualizarse
para emitir señales; no se crea presencia de instalaciones antiguas por inferencia.

## Contrato y comportamiento

`POST /v1/projects/radar/presence` requiere el Bearer vigente de una instalación
vinculada al canal configurado. JSON exclusivo `{sequence,online,alertsEnabled}`,
máximo 256 bytes, secuencia positiva entera segura y límite 180 solicitudes/hora
por instalación. La secuencia y peticiones se serializan y persisten en SQLite;
el servidor usa su propia hora de recepción. Repeticiones/solicitudes atrasadas no
actualizan la señal. Sin teléfono arbitrario, hostname, perfil ni expedientes.

El cliente informa cada minuto, incluso durante una búsqueda SEACE lenta. El
cierre intenta `online:false`; apagado, suspensión o red perdida se detectan por
una concesión de cinco minutos. Cron `*/5 * * * *` reconcilia grupos por
destinatario/canal, conservando el cron del recordatorio. Una instalación fresca
con búsqueda habilitada mantiene el grupo online; pausa total suprime avisos.
No se afirma que el hardware se haya apagado ni se garantiza una oportunidad.

Notificaciones sólo con consentimiento, rol RADAR, ventana abierta y 08–20 Perú.
No renuevan la ventana. Se coalescen transiciones y se separan cinco minutos, con
reserva D1 atómica por revisión. No se reintentan incertidumbres/rechazos para
esa revisión. Ledger propio: no altera pacing de oportunidades, contexto de
licitaciones ni recordatorio; un aviso operativo puede coincidir cerca de otro.
Se revalidan estado agregado, consentimiento y ventana antes de Meta. La
autorización usa la resolución de rol HMAC existente del VPS; un fallo suspende
el envío. Los recibos se registran sólo después de validar la firma Meta.

La migración aditiva `0019` crea `radar_presence`, vista de instalaciones
habilitadas, estados agregados y ledger. La revisión periódica está acotada y
ordena por última comprobación para que grupos con permiso pendiente no
impidan revisar los demás. El webhook sigue siendo único; los otros roles se
conservan. No hay nuevas variables secretas ni trabajo SEACE en servidor.

## Activación, previa autorización

1. Revalidar versión, bundle, bindings, secretos por nombre y schedules actuales.
2. Respaldar D1 de forma privada y comprobar restauración. Confirmar `0018`;
   aplicar sólo `0019` y registrar su migración. No ejecutar migraciones ajenas.
3. Publicar exclusivamente el paquete aislado probado y verificar cron, salud,
   API autenticada y firma de recibos; no subir el árbol sucio completo.
4. Ejecutar el escritorio actualizado. No simular señales de vida de una app
   antigua que no está enviándolas: produciría desconexiones falsas cinco minutos
   después. No reiniciar la app abierta sin coordinar el cambio con el usuario.

Rollback: restaurar Worker anterior y schedules previos (sólo recordatorio).
Las tablas aditivas pueden permanecer; no borrar ventanas, vínculos ni selecciones.
No publicar instalador público ni modificar VPS, DNS o callback Meta como parte
de esta activación.

## Validación local

316 pruebas del Worker en 37 archivos, incluidos 16 casos de presencia; typecheck
y tipos Env del Wrangler fijado en el proyecto correctos. 106 pruebas sobre el
paquete aislado, incluida la ruta real de presencia y recibos Meta con firma
inválida/válida. Deploy en seco con Wrangler 4.157.0. Migración comprobada desde
base vacía y esquema anterior sin generar presencia para instalaciones existentes.
Desktop: 231 pruebas del árbol preparado, typecheck y build; temporizador separado,
contador persistido, orden de cierre/reinicio y recuperación tras fallo de red.
