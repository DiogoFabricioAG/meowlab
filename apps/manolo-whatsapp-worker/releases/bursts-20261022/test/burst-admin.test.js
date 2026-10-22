import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { burstAdminHttp, BURST_ADMIN_PATH } from "../src/conversations/burst-admin";
import { burstKey } from "../src/conversations/burst-policy";
const testEnv = { ...env, VPS_BRIDGE_HMAC_SECRET: "a-test-shared-hmac-secret-at-least-32-chars" };
let contactId;
const target = {
  id: "test-admin-message",
  inputType: "text",
  text: "test",
  interactionId: null,
  phoneNumberId: "444444444444449",
  to: "51900000009"
};
async function call(data, skew = 0, tamper = false) {
  const body = JSON.stringify(data);
  const timestamp = String(Math.floor(Date.now() / 1e3) + skew);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(testEnv.VPS_BRIDGE_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`)
  )), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return burstAdminHttp(new Request(`https://test${BURST_ADMIN_PATH}`, {
    method: "POST",
    body: tamper ? `${body} ` : body,
    headers: {
      "X-Manolo-Timestamp": timestamp,
      "X-Manolo-Signature": `sha256=${signature}`,
      "X-Manolo-Request-Id": String(data.requestId)
    }
  }), testEnv);
}
beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO tenants(id, name) VALUES ('burst-admin-test', 'Admin')"),
    env.DB.prepare("INSERT INTO whatsapp_numbers(id, tenant_id, phone_number_id) VALUES ('burst-admin-number', 'burst-admin-test', ?)").bind(target.phoneNumberId),
    env.DB.prepare("INSERT INTO contacts(tenant_id, whatsapp_user_id) VALUES ('burst-admin-test', ?)").bind(target.to)
  ]);
  contactId = (await env.DB.prepare("SELECT id FROM contacts WHERE tenant_id = 'burst-admin-test'").first()).id;
});
describe("burst administration", () => {
  it("rejects missing signature, expired and altered bodies", async () => {
    expect((await burstAdminHttp(new Request(`https://test${BURST_ADMIN_PATH}`, { method: "POST", body: "{}" }), testEnv)).status).toBe(401);
    const data = { requestId: "test-admin-expired", action: "inspect", tenantId: "burst-admin-test", contactId };
    expect((await call(data, -600)).status).toBe(401);
    expect((await call(data, 0, true)).status).toBe(401);
  });
  it("does not allow cross-tenant lookup or release without operator review", async () => {
    expect((await call({ requestId: "test-admin-cross", action: "inspect", tenantId: "other", contactId })).status).toBe(404);
    expect((await call({ requestId: "test-admin-review", action: "release", tenantId: "burst-admin-test", contactId })).status).toBe(400);
  });
  it("releases only the inspected drained state, invalidates buttons, audits and replays", async () => {
    const stub = env.WHATSAPP_BURSTS.getByName(burstKey("burst-admin-test", target));
    await env.DB.prepare(`INSERT INTO contact_role_states(tenant_id, contact_id, role_key, state_json)
      VALUES ('burst-admin-test', ?, 'enterprise-advisor', ?)`).bind(contactId, JSON.stringify({ revision: 3, phase: "review", confirmation: { buttonId: "old" }, billing: { productsText: "fixture" } })).run();
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("INSERT OR REPLACE INTO safety VALUES (1, 1)");
    });
    const inspect = await (await call({ requestId: "test-admin-inspect", action: "inspect", tenantId: "burst-admin-test", contactId })).json();
    const data = {
      requestId: "test-admin-release",
      action: "release",
      tenantId: "burst-admin-test",
      contactId,
      expected: inspect.fingerprint,
      reviewRef: "TEST-REVIEW-1",
      verifiedFacturaya: true
    };
    expect((await call({ ...data, expected: "0".repeat(64) })).status).toBe(409);
    expect((await call(data)).status).toBe(200);
    expect(await (await call(data)).json()).toMatchObject({ ok: true, replayed: true });
    const checkpoint = JSON.parse((await env.DB.prepare("SELECT state_json FROM contact_role_states WHERE tenant_id = 'burst-admin-test' AND contact_id = ?").bind(contactId).first()).state_json);
    expect(checkpoint.confirmation).toBeUndefined();
    expect(checkpoint.billing.productsText).toBe("fixture");
    expect(checkpoint.revision).toBe(4);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) n FROM reviews").one().n).toBe(1);
    });
  });
  it("refuses release of a fiscal issuance still in progress", async () => {
    await env.DB.prepare("UPDATE contact_role_states SET state_json = ? WHERE tenant_id = 'burst-admin-test'").bind(JSON.stringify({ revision: 5, phase: "issuing" })).run();
    const inspected = await (await call({ requestId: "test-admin-issuing-inspect", action: "inspect", tenantId: "burst-admin-test", contactId })).json();
    expect(await (await call({
      requestId: "test-admin-issuing-release",
      action: "release",
      tenantId: "burst-admin-test",
      contactId,
      expected: inspected.fingerprint,
      reviewRef: "TEST-REVIEW-2",
      verifiedFacturaya: true
    })).json()).toMatchObject({ error: "issuance_requires_reconciliation" });
  });
});
