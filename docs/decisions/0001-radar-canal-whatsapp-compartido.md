# 0001. RADAR como proyecto consumidor del canal WhatsApp compartido

- Estado: aceptado como dirección de integración; implementación pendiente.
- Fecha: 2026-10-18.
- Responsables: fundador de MeowLab y mantenimiento de Manolo/RADAR.

## Contexto

RADAR se instala en equipos de usuarios y el titular de las credenciales de
Meta es MeowLab. Manolo ya recibe eventos en un webhook único y resuelve un rol
efectivo por contacto. Añadir un callback paralelo o reemplazar ese rol por
`radar` puede interferir con Facturas y otros comportamientos existentes.

## Decisión

Registrar RADAR como proyecto independiente de MeowLab y consumidor de una
capacidad de notificaciones, conservando el ingreso existente y los roles.
El fundador aprobó esta dirección tras revisar el posible cruce con Manolo y
solicitó registrar el proyecto.

Las credenciales Meta y la autoridad para comprobar la ventana de 24 horas
pertenecen al servicio central. El escritorio se vinculará a su destinatario y
solicitará alertas mediante autenticación propia. Sólo se autorizarán mensajes
de texto dentro de la ventana auténtica y con consentimiento; no habrá respaldo
automático por plantilla. El proyecto no obtiene permiso de envío por el mero
hecho de aparecer en un catálogo documental.

RADAR conserva búsquedas, selección y conocimiento del negocio en SQLite local.
El servicio sólo recibirá la alerta necesaria para transportarla y los metadatos
operativos mínimos. La ficha [RADAR](../apps/radar.md) fija límites y pendientes.

## Alternativas consideradas

- Distribuir el token/App Secret Meta: expondría credenciales compartidas en
  máquinas ajenas; se descarta para distribución.
- Registrar un segundo callback para el mismo ingreso: contradice la arquitectura
  de webhook único y duplica responsabilidades.
- Registrar RADAR como rol activo del contacto: cambia la atención conversacional
  de Manolo, innecesaria para una capacidad de alertas.

## Consecuencias

Se requiere vinculación, autorización por instalación/proyecto, baja, ventanas,
deduplicación y trazabilidad de envíos. No se usa la asignación de rol como
permiso de notificación. Los contratos HTTP y la persistencia aún deben definirse
y probarse. El servicio no descubrirá oportunidades mientras el escritorio esté
apagado; tampoco replica sus datos de negocio.

## Plan de adopción y rollback

Este corte sólo incorpora el registro y los pendientes. Las futuras entregas
deberán mantener los clientes anteriores y activarse de forma controlada tras
probar aislamiento y permisos. La baja/desactivación de una instalación deberá
detener sus envíos sin cambiar el rol del contacto ni la configuración de Meta.
No existe un despliegue que revertir en este registro.

## Evidencia de validación

Revisión de la entrada de Manolo (`webhookResponse`), `resolveEffectiveRole`,
`RoleRegistry` y la ficha del módulo local de RADAR. Validación de catálogo JSON,
enlaces internos, diff y regeneración del tablero. Sin envío real, pruebas de
runtime ni cambios a producción en esta tarea documental.
