# 0004. Un turno para texto e imágenes contiguas

- Estado: aceptado, publicado en Worker `b5f73411`.
- Fecha: 2026-11-06.
- Responsables: mantenimiento de Manolo.

## Contexto

ADR-0002 agrupa textos, pero una imagen es una barrera que fuerza procesar el
texto anterior sin esperar los tres segundos. El pedido suele dividir cliente
y pago en texto y productos en una foto; se generan dos turnos incompletos.
Además, el runtime sólo normalizaba el primer elemento del lote.

## Decisión

Extender el mismo DO por conversación para agrupar texto e imágenes sin
interacción. Cada llegada reinicia la espera de tres segundos de silencio;
se mantienen máximo diez segundos, veinte entradas y 8.000 caracteres originales.
Como límite adicional se admiten tres imágenes por turno. Al llegar a límites se
divide la cola sin descartar entradas. Botones/listas, audios y documentos siguen
siendo barreras FIFO. Mensajes admitidos durante inferencia van al turno siguiente.

El runtime normaliza cada imagen con Luna, conserva original/ID/tipo y análisis
en D1, y sincroniza el contenido normalizado de cada original con el shadow VPS.
El rol recibe una sola entrada consolidada y una marca interna de contexto visual
exitoso. No se persisten bytes/base64 en la cola. Los límites de descarga y
análisis por imagen se conservan. Fallar una imagen no descarta el texto contiguo;
sin texto ni análisis útil se pide reenviar una imagen legible.

Los campos legibles se usan para preparar cliente/productos/cantidades/precios.
No se ejecutan instrucciones contenidas en la foto. «Genera factura» junto con
datos actualiza el borrador; pedir sólo revisión sigue sin modificarlo. La
autorización fiscal conserva su botón vigente: agrupación/visión nunca emiten.

## Consecuencias

No hay nueva migración, binding, ruta pública, cola ni fuente de verdad. Se
mantienen los estados de incertidumbre, límites de retención y recuperación de
ADR-0002. La espera depende también de alarmas/turnos previos, no es un SLA.
Un turno puede incluir varias llamadas externas (visión, decisión y extracción),
aunque ofrece una respuesta de negocio conjunta. Un resumen extenso puede
requerir varios mensajes de WhatsApp.

## Adopción y rollback

Publicar el planificador, normalización y rol como entrega aislada coherente.
Preservar configuración, namespace DO, datos pendientes, credenciales y otros roles.
Rollback de código mantiene las entradas originales; la política anterior volvería
a separar imágenes. No borrar la cola ni reejecutar turnos inciertos.

## Evidencia

Pruebas de texto/imagen en ambos órdenes, campos de cliente/pago/productos,
persistencia de originales/imagen leída, deduplicación, error visual parcial,
límites, aislamiento, botones y mensajes durante inferencia. Suite local completa
471 pruebas correctas; paquete aislado final375 y typecheck correctos. Publicación
y rollback en [el acta](../operations/manolo-multimodal-2026-11-06.md).
