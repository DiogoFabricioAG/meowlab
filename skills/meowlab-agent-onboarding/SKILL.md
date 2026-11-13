---
name: meowlab-agent-onboarding
description: Incorporar un servicio externo como agente o capacidad de MeowLab/Manolo, definir sus contratos y preparar o implementar su integración sin explorar todo el monorepo. Usar para altas de roles conversacionales, adaptadores de servicios y handoffs al mantenedor de MeowLab; no para operar agentes ya existentes.
---

# Incorporar agentes a MeowLab

Permitir que un agente que trabaja en otro servicio prepare una integración
implementable en MeowLab con un conjunto pequeño de contratos. Esta skill no
otorga acceso a infraestructura ni sustituye la autorización del propietario.

## Elegir el recorrido

- **Rol conversacional:** el usuario conversará con el servicio desde WhatsApp.
  Éste es el recorrido predeterminado si pide crear un agente.
- **Capacidad/notificaciones:** el servicio sólo solicita una acción o envía
  avisos autorizados. No necesita sustituir el rol activo del destinatario.
- **Ambos:** separar rol, permisos del servicio y consentimiento para avisos.
  Tener un rol asignado no concede autorización para notificaciones.

No existe una API genérica comprobada de alta de agentes. No inventar
`POST /agents`, un registro automático por JSON, rutas ni provisión dinámica.
El registro de roles del Worker es código y el catálogo de la TUI es PostgreSQL.

Lee [contratos de plataforma](references/platform-contracts.md). Después:

- Para un rol, lee [integración de roles](references/role-integration.md).
- Para servicios externos, avisos o trabajo sin acceso a MeowLab, lee
  [integración entre servicios](references/service-integration.md).

## Pedir sólo los datos que cambian la integración

Obtener del pedido o proyecto actual: nombre/clave del servicio, propósito,
operaciones reales disponibles, usuarios/empresas autorizados, modalidad de
interacción, estado que necesita conservar y acciones que requieren confirmación.
Para un backend, identificar contrato y mecanismo de autenticación existente.
No pedir claves reales: documentar únicamente nombres de secretos y consumidor.
Si sólo falta una decisión material, preguntar por ella; el resto puede quedar
como supuesto explícito o pendiente. No inventar herramientas del servicio.

## Trabajar desde otro repositorio

No buscar todo el disco ni clonar MeowLab por iniciativa propia. Inspeccionar
primero sólo la documentación y superficie pública del servicio actual.
Crear el contrato y adaptador del lado del servicio cuando la tarea lo autorice,
con ejemplos sintéticos, errores, permisos e idempotencia verificables.
Preparar el handoff usando [esta plantilla](assets/meowlab-handoff.md).

Si no hay acceso de escritura a MeowLab, entregar ese paquete al mantenedor y
dejar **pendiente de integración**. No afirmar que el agente existe en runtime,
que aparece en la TUI o que está desplegado. El agente de MeowLab completa
registro, composición, migraciones y activación desde su propio entorno.

## Con acceso al repositorio MeowLab

Localizar su raíz por el workspace o una ruta proporcionada, no por una ruta
Windows fija. Respetar primero `AGENTS.md` y su lectura obligatoria:
`docs/README.md`, `docs/project/status.md`, tarea en `docs/project/board.json`
y `git status --short --branch`. No omitir esa entrada por usar esta skill.

Leer después sólo la fila correspondiente de
`docs/apps/manolo-platform.md` y los archivos concretos del recorrido elegido.
Los índices se consultan para navegar, no para leer todos sus documentos.
Antes de tocar registros o composición compartidos, revisar el tablero y acordar
propiedad si otro agente está trabajando ahí. No sobrescribir su trabajo.

La evidencia inspeccionada al crear esta skill es del **2026-10-31**. Código,
status y versión realmente activa prevalecen sobre esta guía. Un rol nuevo en
el árbol local no prueba despliegue; las releases aisladas pueden diferir del
árbol principal. Si el trabajo exige modificar una frontera no documentada,
ampliar sólo la lectura de ese contrato, no auditar todo el repositorio.

## Límites que se conservan

- Un solo webhook Meta, en el Worker; ningún callback paralelo del servicio.
- Roles, notificaciones y membresía/permiso de empresa son conceptos distintos.
  No asignar un rol globalmente ni cambiar contactos ajenos para probar un alta.
- El rol usa contratos inyectados: no conoce tokens ni HTTP de Meta/proveedores.
- No compartir secretos Meta/HMAC de plataforma con escritorios o servicios no
  confiables. Los servicios distribuidos usan credenciales propias y revocables.
- Mantener aislamiento tenant/contacto/rol, deduplicación Meta, orden de ráfagas
  y confirmaciones vigentes. No reenviar a ciegas un resultado externo incierto.
- D1 sigue siendo el runtime principal de conversaciones/checkpoints;
  PostgreSQL autoriza roles/permisos/FacturaYa; el DO de ráfagas sólo coordina.
  No migrar esas autoridades como parte de un alta.
- Logs sin mensajes privados, teléfonos, documentos, tokens ni payloads fiscales.
- Crear archivos locales no autoriza commit, push, migración remota, asignación
  de roles, pruebas con usuarios reales o despliegue. Operar sólo con autorización
  concreta para esos pasos y después de las pruebas pertinentes.

## Entrega y validación

Entregar cambios acotados o handoff con propósito, recorrido, clave, contrato,
estado/autoridad, permisos, pruebas y pasos pendientes. Distinguir:
**preparado**, **integrado localmente**, **registrado en catálogo** y
**desplegado/activado**. No presentar un catálogo documental como registro vivo.

Con acceso a MeowLab, aplicar su matriz `docs/development/validation.md`:
pruebas del rol/contrato, aislamiento, duplicados, errores, reanudación y
confirmación. Para nuevas rutas privadas, firma inválida/expirada y replay.
Actualizar documentación y tablero; regenerar con
`node tools/board/build-board.mjs` y verificar con `--check`.
Sin repositorio, ejecutar las pruebas del servicio y marcar las verificaciones
del lado MeowLab como pendientes, no como aprobadas.
