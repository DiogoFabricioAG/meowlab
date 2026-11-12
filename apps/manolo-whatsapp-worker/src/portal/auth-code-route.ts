import { canonicalBridgePayload } from "../bridge/signature";
import { AUTH_CODE_WORKER_PATH, isAuthCodeRequest } from "../bridge/portal-link-contracts";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 4_096;

type AuthCodeEnv = Env & {
  /** Shared with the bridge; only this route accepts it. Optional until phase 2 is deployed. */
  AUTH_CODE_HMAC_SECRET?: string;
};

type Log = (event: string, details?: Record<string, unknown>) => void;

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function validSignature(secret: string, timestamp: string | null, signature: string | null, body: string, nowSeconds: number) {
  if (!timestamp || !signature || !/^\d{10,}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!match) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, hexToBytes(match[1]), encoder.encode(canonicalBridgePayload(timestamp, body)));
}

/** Meta authentication template with a "copy code" button: the code goes in the body and in the button. */
export function authTemplatePayload(to: string, code: string, template: string, language: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: language },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}

/**
 * Internal route the bridge uses to deliver portal one-time codes (ADR-0006). It never
 * reaches the AI or the roles, and it does nothing until its secret and template exist.
 */
export async function authCodeResponse(
  request: Request,
  env: AuthCodeEnv,
  log: Log,
  fetchImpl: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = env.AUTH_CODE_HMAC_SECRET?.trim();
  const template = env.WHATSAPP_AUTH_TEMPLATE?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!secret || secret.length < 32 || !template || !phoneNumberId || !env.META_ACCESS_TOKEN) {
    log("portal_auth_code_not_configured");
    return json({ error: "not_configured" }, 503);
  }
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY_BYTES) return json({ error: "request_too_large" }, 413);
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return json({ error: "request_too_large" }, 413);
  if (!await validSignature(secret, request.headers.get("X-Manolo-Timestamp"), request.headers.get("X-Manolo-Signature"), body, nowSeconds)) {
    log("portal_auth_code_rejected", { reason: "invalid_signature" });
    return json({ error: "unauthorized" }, 401);
  }
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return json({ error: "invalid_json" }, 400); }
  if (!isAuthCodeRequest(payload) || request.headers.get("X-Manolo-Request-Id") !== payload.requestId) {
    return json({ error: "invalid_request" }, 400);
  }

  const version = env.META_GRAPH_API_VERSION?.trim() || "v25.0";
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(authTemplatePayload(payload.to, payload.code,
        template, env.WHATSAPP_AUTH_TEMPLATE_LANGUAGE?.trim() || "es_PE")),
    });
    if (!response.ok) {
      log("portal_auth_code_send_failed", { status: response.status });
      return json({ status: "failed" }, 502);
    }
    log("portal_auth_code_sent");
    return json({ status: "sent" }, 200);
  } catch {
    log("portal_auth_code_send_failed", { reason: "graph_api_request_error" });
    return json({ status: "failed" }, 502);
  }
}

export { AUTH_CODE_WORKER_PATH };
