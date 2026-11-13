# Manolo: system design para portfolio

Diagrama de arquitectura actual, corte 2026-11-06:
[abrir HTML interactivo](manolo-portfolio.html).
Fuente editable: [Archify JSON](manolo-portfolio.architecture.json).

## Alcance

Vista pública del recorrido de facturación, con doce componentes y sin datos
de clientes, direcciones de servidores, credenciales ni identificadores privados.
Worker, bandeja durable y orquestador representan responsabilidades lógicas;
el orquestador ejecuta dentro del Worker, no es un microservicio independiente.
Luna / Decisions API agrupa dependencias de IA y no implica un solo endpoint.
FacturaYa integra el procesamiento fiscal hacia SUNAT: Manolo no la invoca
directamente. El retorno de texto, botones y documentos usa Meta Graph API.

La landing tiene despliegue separado. Otros roles, TUI y herramientas operativas
quedan fuera de esta vista del flujo fiscal. D1 sigue siendo el runtime de
conversación; PostgreSQL autoriza y recibe mensajes en sombra. No se presenta la
migración futura como terminada. La capacidad y disponibilidad de proveedores
externos no se representan como garantías propias.

Fuentes: [arquitectura actual](current-system.md),
[plataforma](../apps/manolo-platform.md),
[agrupación texto e imágenes](../decisions/0004-rafagas-texto-imagen.md),
[pago único](../operations/manolo-single-payment-2026-11-06.md),
`src/index.ts`, `src/conversations/whatsapp-burst.ts`,
`src/roles/enterprise-advisor-role.ts` y `src/node/facturaya/operation-service.ts`
del paquete `apps/manolo-whatsapp-worker`.

El HTML es autónomo y permite exportar desde el visor. Contenido en español;
controles fijos y atributo HTML de idioma usan el fallback inglés de Archify.

## Evidencia de entrega

- diagram_type: architecture
- specification_sha256: `ef621f167f5c25a0cc42b857dec660449c3ff7e5571dd4a25c32999580dfc054`
- artifact_sha256: `2b4e958a5f41598a5ae03af7ceb6171157a3ecd3f96146974de1485ba525d736`
- validation: 9/9 showcase, 0 errores, 0 advertencias
- browser_evidence: passed
- visual_review: passed
- correction_rounds: 1 (ajuste vertical tras la primera entrega)

`validate` y `deliver` ejecutados con Archify. `visual-check` comprueba
1440×900, 1600×1000, 1920×1080 y 2048×1320; evidencia en
[recibo de navegador](manolo-portfolio.visual-check.json).
Revisión perceptual de capturas 1440×900 claro y 2048×1320 oscuro: texto legible,
rutas sin cruces, etiquetas separadas y composición contenida, sin recortes.
No se modificó código de ejecución ni se hizo un despliegue por esta tarea.
