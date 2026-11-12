# 0007. Cobros por suscripción con Mercado Pago y Yape

- Estado: propuesto
- Fecha: 2026-11-11
- Responsable: MeowLab

## Contexto

El informe ejecutivo 2027–2029 (v0.1, tarifas al 08/11/2026) fija un catálogo de
agentes contratables por separado, con IGV incluido:

| Agente | Rol en Manolo | Tarifa/mes | Estado |
| --- | --- | --- | --- |
| Invoice Cat | `enterprise-advisor` | S/ 39 | En producción (pruebas internas) |
| Sales Cat | — | S/ 59 | Pruebas internas |
| Stock Cat | — | S/ 29 | Diseño |
| Reorder Cat | — | S/ 25 | Diseño |
| Support Cat | — | S/ 39 | Diseño |
| Collections Cat | — | S/ 25 | Diseño |

Descuento por agentes activos: 1 → 0 %, 2 → 10 %, 3–4 → 15 %, 5–6 → 20 %.

`meowlab-platform` (Python, sin desplegar) ya investigó Mercado Pago (SPEC-0001,
decisión 30): suscripción recurrente, Yape como alternativa asistida, webhook
firmado, un pago no puede conceder dos periodos y una captura nunca acredita un
pago. Este ADR reutiliza esas reglas en la plataforma vigente (bridge y
PostgreSQL), sin depender de aquel código.

Decisiones del operador (2026-11-11): suscripción recurrente; si no paga, avisos,
días de gracia y luego Manolo deja de emitir; Yape de dos formas, por Mercado Pago
y con QR o número propio verificado por un administrador.

## Decisión

1. **Quién paga.** Cada empresa (tenant de FacturaYa) tiene una suscripción. La
   paga y administra una cuenta del portal vinculada a un WhatsApp que es miembro
   de esa empresa.
2. **Catálogo y precio en el servidor.** Catálogo y descuentos viven en PostgreSQL
   y se versionan con migraciones. El importe mensual = suma de tarifas × (1 −
   descuento). El cliente nunca envía un importe: lo calcula el servidor. Sólo los
   agentes marcados como disponibles se pueden contratar (hoy, Invoice Cat).
3. **Mercado Pago, suscripción recurrente.** `preapproval` sin plan asociado, con
   `external_reference` propio, importe en PEN y frecuencia mensual. El cliente
   autoriza en el checkout de Mercado Pago (tarjeta o los medios que habilite la
   cuenta). Agregar o quitar agentes actualiza el importe del `preapproval` para el
   siguiente cobro.
4. **Sólo el servidor acredita.** El webhook (`x-signature`, HMAC-SHA256 sobre
   `id:…;request-id:…;ts:…;`) se verifica y luego se reconsulta el recurso en la
   API de Mercado Pago. El retorno del navegador, la pantalla de éxito o una captura
   nunca habilitan un periodo. Cada pago concede como máximo un periodo (claves
   únicas por referencia del proveedor) y su importe debe coincidir con el
   esperado.
5. **Yape.**
   - *Por Mercado Pago:* enlace o QR de pago de Mercado Pago con Yape; se acredita
     igual que el punto 4.
   - *QR o número propio:* el cliente paga al Yape de MeowLab y envía la
     operación o captura; queda **pendiente** hasta que un administrador la apruebe
     en la pestaña Negocio, que concede exactamente un periodo.
6. **Vigencia y bloqueo.** La empresa tiene derecho a los agentes pagados hasta el
   fin del periodo. Avisos antes del vencimiento; días de gracia después; vencida
   la gracia, `enterprise-advisor` no crea ni emite documentos para esa empresa
   (consultar lo emitido sigue). El bloqueo se aplica en el bridge, antes de llamar
   a FacturaYa.
7. **Dónde vive.** El ledger y el cliente de Mercado Pago (con su access token)
   viven en el bridge y en PostgreSQL de la plataforma, que ya es la autoridad de
   empresas y permisos. El portal muestra planes, inicia el checkout y recibe el
   webhook público, que reenvía firmado al bridge. Los secretos de Mercado Pago no
   salen del VPS.

## Consecuencias

- Empezar en modo prueba con credenciales de prueba y usuarios de prueba de
  Mercado Pago; producción requiere credenciales productivas y la cuenta verificada.
- Las comisiones de Mercado Pago no están en el modelo financiero (el informe lo
  advierte); medirlas desde el primer cobro.
- **Collections Cat:** el informe lo define como seguimiento *interno* de cuentas
  por cobrar del comercio, con alcance limitado por las políticas de WhatsApp. Usarlo
  para cobrar las suscripciones de MeowLab es otro uso: los recordatorios de pago
  de un servicio propio son mensajes de utilidad permitidos, pero conviene decidir
  si es el mismo agente que se vende o un rol interno.
- Por decidir: días de gracia y avisos, prueba gratis, cambio de plan a mitad de
  periodo (prorrateo o desde el siguiente cobro) y emisión del comprobante de
  MeowLab por cada cobro.

## Fases

1. Catálogo, cálculo de precio y suscripción en Mercado Pago (prueba): checkout,
   webhook, ledger y estado en el portal.
2. Bloqueo por falta de pago en el bridge, avisos y días de gracia.
3. Yape por QR propio con aprobación en Negocio, y métricas de cobros.
4. Collections Cat: cobro por WhatsApp con enlace de Mercado Pago o QR de Yape.
