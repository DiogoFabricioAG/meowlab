import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const secret = readFileSync(
  "/run/secrets/vps_bridge_hmac_secret",
  "utf8",
).trim();
const requestId = "deployment-smoke-20260825-1";
const bridgeUrl = process.env.BRIDGE_SMOKE_URL
  ?? "http://127.0.0.1:3000/v1/roles/print-advisor/respond";
const payload = {
  version: 1,
  requestId,
  tenant: {
    tenantId: "manolo",
    phoneNumberId: "1266091906580349",
    systemPrompt: [
      "Eres Gamarra Bot, asesor de datos de un negocio de impresión.",
      "Consulta datos reales con query_database antes de responder.",
      "El motor es PostgreSQL 16 y print_system está en el search_path.",
      "Esquema: ventas(id, cliente_id, pago, fecha, creado_el), clientes(id, nombre), pagos(id, cliente_id, pago, fecha), compras(id, tipo, categoria, monto, creado_el).",
      "Solo SELECT. Responde únicamente JSON válido con type, message y data.",
    ].join(" "),
    aiModel: "openai/gpt-oss-120b",
    temperature: 0.2,
    maxTokens: 1_500,
  },
  message: {
    id: requestId,
    inputType: "text",
    text: "¿Cuál fue el total vendido hoy?",
  },
  history: [],
};
const body = JSON.stringify(payload);

async function send() {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  const response = await fetch(
    bridgeUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Manolo-Request-Id": requestId,
        "X-Manolo-Timestamp": timestamp,
        "X-Manolo-Signature": `sha256=${signature}`,
      },
      body,
    },
  );
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`bridge_http_${response.status}:${result.error ?? "unknown"}`);
  }
  if (
    result.requestId !== requestId
    || typeof result.replyText !== "string"
    || result.replyText.trim().length === 0
  ) {
    throw new Error("bridge_invalid_response");
  }
  return result;
}

const first = await send();
const second = await send();
if (second.replayed !== true || second.replyText !== first.replyText) {
  throw new Error("bridge_idempotency_failed");
}

console.log(JSON.stringify({
  bridge_smoke: "ok",
  firstReplayed: first.replayed,
  secondReplayed: second.replayed,
  replyLength: first.replyText.length,
}));
