# Proyecto RADAR

## Actualización 2026-10-31: rol RADAR

RADAR está registrado en `RoleRegistry` y en el catálogo PostgreSQL como
«RADAR · Licitaciones», asignable por la TUI. Véanse
[ADR-0003](../decisions/0003-radar-rol-licitaciones.md) y la
[publicación](../operations/radar-role-2026-10-31.md). Las descripciones
históricas inferiores de RADAR exclusivamente como consumidor de alertas quedan
ampliadas por esta decisión; se conserva la API para instalaciones existentes.

- Identificador: `radar`.
- Organización: MeowLab.
- Registro autorizado: 2026-10-18.
- Repositorio: [radar-compras-publicas](https://github.com/DiogoFabricioAG/radar-compras-publicas).
- Ubicación de desarrollo: `D:/Proyectos2026/licitaciones`.
- Registro estructurado: [`../project/projects.json`](../project/projects.json).
- Estado: servicio compartido publicado y activado; envío real e instalador actualizado pendientes.

## Activación — 2026-10-18

Versión `02e3ea4b-da57-47ba-b73d-4ecb4fe8f849` publicada sobre el Worker activo,
preservando su fuente previa y configuración; D1 0014 aplicada y habilitada.
Registro, bloqueo sin vínculo y revocación comprobados por HTTPS. No se han
enviado mensajes reales ni publicado un instalador nuevo.
[Evidencia y rollback](../operations/radar-activation-2026-10-18.md).

## Corte de implementación — 2026-10-18

El Worker existente incorpora la capacidad `src/radar/` y la migración D1 0014,
desactivada por defecto. Implementa instalación/token propio, códigos de un solo
uso, vinculación y baja desde mensajes Meta firmados, ventanas de 24h y API
autenticada de alertas. No cambia roles ni incorpora las alertas al historial
fiscal. [Contrato y activación](radar-whatsapp-api.md).

En RADAR, `whatsapp-service.ts` conecta el programador al arranque Bun y ofrece
vinculación/estado/horario/baja desde el chat por function calling y RPC.
`whatsapp-discovery.ts` reutiliza los temas aprendidos para buscar todas las
categorías/páginas con concurrencia dos, sin trasladar la búsqueda al servidor.
La credencial propia revocable se conserva en SQLite local sin cifrado de
aplicación; los secretos Meta permanecen en MeowLab.

El resto de la ficha describe el contrato aprobado. Los apartados marcados como
pendientes en la ficha inicial se resuelven por el contrato de API enlazado;
la comprobación de entrega real y el nuevo instalador siguen pendientes. La
activación del servicio consta en el corte superior.

## Producto y fuentes de verdad

RADAR es una aplicación de escritorio para proveedores peruanos. Mantiene una
conversación sobre su negocio, consulta SEACE/OECE y ayuda a investigar y
presupuestar oportunidades. El producto principal usa Bun/Electrobun y SQLite
local; la landing y el backend comercial viven en su propio repositorio.

El perfil, conversaciones, oportunidades, históricos, requerimientos y precios
del usuario permanecen en el escritorio. Los datos de `samples/` son demostrativos
y no constituyen evidencia de mercado. El repositorio de MeowLab no recibe ni
duplica el código de RADAR.

## Integración aprobada con MeowLab

RADAR participa como **consumidor de notificaciones** del canal compartido,
sin sustituir el rol conversacional del contacto. El catálogo de proyectos es
documental: no es `RoleRegistry`, ni configura tenants, usuarios, permisos o
suscripciones de Meta en producción.

Se conserva el webhook único del Cloudflare Worker de Manolo. No se registra
un callback paralelo ni se modifica la configuración de Meta para este alta.
La decisión se describe en [ADR-0001](../decisions/0001-radar-canal-whatsapp-compartido.md).

El recorrido implementado localmente es:

1. El escritorio obtiene una identidad de instalación y un código temporal de
   vinculación desde MeowLab mediante un contrato autenticado.
2. El usuario escribe ese código al WhatsApp compartido. El ingreso existente
   verifica la firma de Meta y deduplica el evento. El flujo de vinculación se
   atiende explícitamente, sin convertir el texto en una orden de facturación.
3. MeowLab vincula el emisor real de WhatsApp con la instalación, registra su
   autorización para alertas y conserva el timestamp del último mensaje entrante
   por par número de negocio/usuario. Los mensajes habituales mantienen su rol.
4. RADAR descubre y selecciona oportunidades en SQLite. Su programador solicita
   enviar una alerta mediante HTTPS, sin acceder a las credenciales de Meta.
5. MeowLab verifica identidad de instalación, destinatario vinculado, autorización,
   límites e idempotencia. Sólo envía texto libre si todavía no se cumplieron
   24 horas desde el último mensaje del usuario, comprobándolo antes del envío.
6. La respuesta distingue aceptación por Meta, rechazo y resultado incierto.
   Los eventos de entrega se correlacionan con el proyecto de origen.

Las rutas, esquema y autenticación están definidos en el
[contrato v1](radar-whatsapp-api.md). No están publicados todavía. Las
credenciales del bridge Worker/VPS no se distribuyen a los escritorios; cada
instalación utiliza una credencial propia revocable con acceso restringido a su
destinatario vinculado.

## Aislamiento respecto a Manolo y Facturas

- No se cambia `active_role_key` por vincular RADAR, solicitar o recibir una alerta.
- La recepción de una alerta no agrega su texto al historial usado por el rol
  fiscal ni modifica sus borradores o checkpoints.
- Una petición de escritorio no puede elegir libremente otro destinatario,
  invocar operaciones de otros proyectos ni proporcionar la hora de apertura.
- La ventana depende de mensajes auténticos del usuario; no de `last_seen_at`
  administrativo, consultas internas, envíos salientes o recibos de entrega.
- Si la ventana vence, se bloquea el envío. No se inicia una conversación usando
  plantillas como respaldo automático.
- Un mensaje al número compartido puede renovar la ventana técnica, pero no
  constituye por sí solo consentimiento para alertas de RADAR.

## Datos y disponibilidad

La integración añade una excepción acotada al recorrido local: el servicio
MeowLab recibe el contenido mínimo de la alerta para transportarlo a WhatsApp.
No se sincronizan la base SQLite, el perfil, las conversaciones, precios ni la
investigación del usuario. El almacenamiento operativo de metadatos de envío,
retención y eliminación deberá concretarse en el contrato del servicio, evitando
contenido sensible en logs.

El cron y la búsqueda siguen ejecutándose en la computadora del usuario. Si el
escritorio está cerrado o sin conexión, no se descubren nuevas oportunidades ni
se solicitan alertas. Un servicio autónomo que busque con el equipo apagado no
forma parte de esta integración.

## Implementado y pendiente

En RADAR existe el módulo independiente
[`whatsapp-cron.ts`](https://github.com/DiogoFabricioAG/radar-compras-publicas/blob/main/desktop/src/bun/whatsapp-cron.ts),
con programación local, selección desde SQLite, deduplicación, transporte Meta
y validación de eventos firmados para ventanas de 24 horas. Sus pruebas
reportadas en la entrega anterior fueron 21 aprobadas, con typecheck y build.
Ese resultado no valida el recorrido entre servicios.

El transporte compartido y la comprobación definitiva de ventana ya se
implementaron en MeowLab; el escritorio conserva planificación y selección.
El modo de plantillas del prototipo no se usa en esta integración compartida.

Unidades implementadas localmente, con evidencia en el [tablero](../project/board.html):

- `radar-vinculacion-instalacion-whatsapp`: contrato de instalación, vinculación,
  consentimiento, baja y credenciales revocables.
- `radar-ventana-whatsapp-compartida`: registrar ventanas desde el ingreso
  autenticado sin alterar roles ni estados fiscales.
- `radar-api-notificaciones-compartidas`: autorización por proyecto/instalación,
  envío, deduplicación, límites y correlación de resultados.
- `radar-cliente-servicio-compartido`: adaptar el módulo de escritorio, conectar
  su ciclo de vida y validar el recorrido completo sin secretos Meta locales.

La activación operativa ya se completó y consta en
`radar-activar-servicio-y-validar-envio-real`; la prueba con usuario queda en
`radar-validar-vinculo-y-entrega-real`. No se publicó el instalador ni se acredita
todavía entrega real de WhatsApp.
