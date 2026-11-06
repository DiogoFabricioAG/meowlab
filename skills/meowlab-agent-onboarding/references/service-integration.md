# Contrato de un servicio externo y handoff

## Desde el repositorio del servicio

Entregar la mínima API o interfaz que el rol necesita. Inventariar operaciones
realmente implementadas, no capacidades imaginadas por el modelo. Para cada una:

- Entrada y salida tipadas, validación y un ejemplo sintético.
- Identidad tenant/empresa/usuario que autoriza la operación. No aceptar un
  `tenantId` del cliente como autorización suficiente.
- Efectos, confirmación necesaria, idempotencia, timeout y errores distinguibles.
- Estado conservado en cada lado y qué dato constituye la fuente de verdad.
- Nombres de credenciales, consumidor y provisión a cargo del operador.

No hay un envelope universal de MeowLab para servicios nuevos. El contrato
propuesto se acuerda con el mantenedor; no llamarlo endpoint existente hasta
comprobar código, autenticación y despliegue. Reutilizar el backend del servicio
para reglas y operaciones de negocio; el rol traduce intención y presenta datos.

Con acceso sólo al servicio, preparar su lado y el handoff de
`assets/meowlab-handoff.md`. Se puede adjuntar un patch propuesto para el lado
MeowLab, claramente sin aplicar. No exigir leer el monorepo entero para ello.
Si se modifica una frontera duradera, proponer ADR; no declarar aprobada una
migración de arquitectura sólo por escribirla en el handoff.

## Notificaciones no son roles

Un servicio que sólo envía alertas puede ser una capacidad autorizada del canal
compartido sin modificar la atención habitual del contacto. Un agente que
también conversa necesita ambas integraciones separadas. No usar una asignación
de rol como consentimiento, vínculo de destinatario o permiso de empresa.

RADAR es un ejemplo específico, **no** un gateway genérico reutilizable con
cualquier payload. Su API tiene prefijo `/v1/projects/radar` y contrato propio:
`POST /installations`, `POST /pairing`, `GET /status`, `POST /alerts` y
`POST /revoke`, con tokens por instalación y esquema de alerta de licitaciones.
No enviar alertas de otro servicio a `/alerts` con campos fiscales o arbitrarios.
Tomar el patrón de consentimiento/credencial revocable como referencia y acordar
un contrato nuevo si el dominio es otro.

En notificaciones distribuidas:

- Credencial propia y revocable para la instalación/servicio; nunca Meta App
  Secret, token Meta o secreto HMAC global dentro de un escritorio distribuido.
- Vinculación explícita con un mensaje real del usuario, baja y comprobación
  central de autorización/ventana antes de enviar. No fabricar un webhook Meta
  ni elegir por el cliente cualquier teléfono como destinatario autorizado.
- Ventana WhatsApp verificada por MeowLab; no ampliar con consultas o envíos.
  No asumir que existe un fallback por plantilla en el servicio actual.
- Idempotencia por identidad de operación y hash del contenido: una respuesta
  incierta se consulta/reconcilia, no se repite con otra clave para forzar envío.
- Probar localmente con transporte simulado; usar usuarios reales sólo con
  autorización expresa y sin emitir comprobantes como smoke test.

## Entrega al mantenedor MeowLab

No hace falta coordinar mediante una herramienta concreta. Entregar un archivo
de handoff o mensaje con contrato y artefactos. No asumir Herdr, SSH o GitHub
disponibles, ni enviar mensajes a terceros sin autorización.

Si el mantenedor acepta una integración de rol, necesita contrato del dominio,
handler y adaptador propuestos, puntos de composición, migración del catálogo
y pruebas. Si acepta sólo notificaciones, necesita autenticación/vinculación,
política de envío y pruebas; no asignar un rol adicional por conveniencia.

Declarar los estados por separado:

| Estado | Evidencia necesaria |
| --- | --- |
| Preparado | Contrato/handoff y pruebas del servicio |
| Integrado localmente | Handler/adaptador/registro compilados y probados |
| Registrado en catálogo | Migración ejecutada en el entorno indicado |
| Publicado | Versión o commit del Worker/bridge correspondiente |
| Activado | Configuración/autorización aplicada al alcance permitido |
| Verificado de extremo a extremo | Prueba autorizada con resultados observados |

Una prueba mock no acredita disponibilidad real de proveedor; un healthcheck no
acredita herramientas ni permisos; un commit no acredita publicación.
