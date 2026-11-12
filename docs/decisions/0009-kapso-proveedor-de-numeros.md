# 0009. Kapso como proveedor de números de WhatsApp

- Estado: aceptado (2026-11-12)
- Responsable: MeowLab

## Contexto

El informe ejecutivo 2027–2029 fija tres etapas de conectividad: Kapso Pro (hasta 30
números, US$ 25/mes con 3 incluidos), Kapso Platform (desde 31) y Meta Cloud API
directa (desde ~100 clientes y permisos). El ADR-0008 da a cada empresa su propio
número. Manolo hoy sólo habla con Meta directo y recibe un único webhook de Meta.

El primer número por Kapso es +1 (208) 441-5504, para el **piloto de un cliente**.

## Decisión

1. **Proveedor por número.** `KAPSO_PHONE_NUMBER_IDS` (lista de `phone_number_id`)
   marca los números conectados por Kapso. El resto sigue con Meta directo. El
   cliente de WhatsApp elige base y credencial por número: Kapso usa
   `https://api.kapso.ai/meta/whatsapp/v24.0` con `X-API-Key` (secreto
   `KAPSO_API_KEY`); el cuerpo de los mensajes es el de Meta Cloud API. Nunca se envía el
   token de Meta a Kapso ni la llave de Kapso a Meta.
2. **Entrada.** Kapso reenvía el payload **original de Meta** (webhook de tipo `meta`)
   a `POST /webhooks/kapso` del mismo Worker, firmado con `X-Webhook-Signature`
   (HMAC-SHA256 hexadecimal del cuerpo crudo con `KAPSO_WEBHOOK_SECRET`). Después de la
   firma, el mensaje sigue exactamente el mismo camino que uno de Meta (deduplicación,
   ráfagas, roles). El Worker sigue siendo la única entrada de WhatsApp: Kapso no
   reemplaza el webhook, lo reenvía.
3. **Cada proveedor sólo habla por sus números.** Una entrega de Kapso para un número que
   no está en la lista, o una de Meta para un número de Kapso, se rechaza (403).
4. **Archivos entrantes.** Para números de Kapso se usa su `download_url` temporal, cuya
   autenticación va en el propio enlace.
5. **Apagado por defecto.** Sin secreto, la ruta responde 503; con la lista vacía, nada
   cambia.

## Consecuencias

- Pasar un número de Kapso a Meta directo (etapa 3) es sacarlo de la lista y apuntar el
  webhook de Meta al Worker; el código de los agentes no cambia.
- Las funciones que hoy sólo usan el número de Manolo (presencia de RADAR, código OTP del
  portal) siguen en Meta directo.
- El número del piloto necesita su empresa y su rol por defecto en Manolo (D1 y la
  plataforma) antes de recibir mensajes.
