import { burstKey } from "./burst-policy";
export const BURST_ADMIN_PATH = "/internal/conversations/burst-admin";
export async function burstAdminHttp(request, env) {
  const json = (body2, status = 200) => Response.json(body2, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = env.VPS_BRIDGE_HMAC_SECRET?.trim();
  if (!secret) return json({ error: "unavailable" }, 503);
  const timestamp = request.headers.get("X-Manolo-Timestamp") || "";
  const signature = request.headers.get("X-Manolo-Signature")?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
  if (!signature || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1e3 - Number(timestamp)) > 300) {
    return json({ error: "unauthorized" }, 401);
  }
  let raw;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "invalid_request" }, 400);
    const parts = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return json({ error: "too_large" }, 413);
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(signature.match(/../g), (byte) => parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(`${timestamp}.${raw}`))) {
    return json({ error: "unauthorized" }, 401);
  }
  let body;
  try {
    const value = JSON.parse(raw);
    if (!value || value.action !== "inspect" && value.action !== "release" || typeof value.requestId !== "string" || !/^[\w:.-]{8,120}$/.test(value.requestId) || value.requestId !== request.headers.get("X-Manolo-Request-Id") || typeof value.tenantId !== "string" || !/^[\w:.-]{1,120}$/.test(value.tenantId) || !Number.isSafeInteger(value.contactId) || Number(value.contactId) <= 0) return json({ error: "invalid_request" }, 400);
    body = value;
    if (body.action === "release" && (typeof body.expected !== "string" || !/^[a-f0-9]{64}$/.test(body.expected) || typeof body.reviewRef !== "string" || !/^[\w.-]{3,100}$/.test(body.reviewRef) || body.verifiedFacturaya !== true)) {
      return json({ error: "review_required" }, 400);
    }
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const contact = await env.DB.prepare(`SELECT c.whatsapp_user_id, n.phone_number_id
    FROM contacts c JOIN whatsapp_numbers n ON n.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.id = ? AND n.active = 1`).bind(body.tenantId, body.contactId).all();
  if (contact.results.length !== 1) return json({ error: "contact_or_channel_not_unique" }, 404);
  const target = contact.results[0];
  const stub = env.WHATSAPP_BURSTS.getByName(burstKey(body.tenantId, {
    id: null,
    interactionId: null,
    inputType: "text",
    text: "",
    to: target.whatsapp_user_id,
    phoneNumberId: target.phone_number_id
  }));
  const result = await stub.review(body);
  return json(result, result.ok ? 200 : 409);
}
