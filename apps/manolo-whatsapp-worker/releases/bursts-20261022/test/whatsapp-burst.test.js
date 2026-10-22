import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { burstKey, planBurst } from "../src/conversations/burst-policy";
import worker, { processConversationTurn } from "../src/index";
function message(text, id = crypto.randomUUID()) {
  return { id, text, interactionId: null, phoneNumberId: "444444444444444", to: "51900000001", inputType: "text" };
}
function entry(text, received = 0, seq = 1) {
  return { seq, received, message: message(text) };
}
describe("burst policy", () => {
  it("waits for three seconds of silence after the last fragment", () => {
    expect(planBurst([entry("hola"), entry("como", 1e3, 2), entry("estas", 2200, 3)], 2500)?.due).toBe(5200);
  });
  it("caps a continuous burst at ten seconds", () => {
    expect(planBurst([0, 2e3, 4e3, 6e3, 8e3, 9500].map((time, i) => entry("dato", time, i)), 9500)?.due).toBe(1e4);
  });
  it("does not join separated bursts even when execution is delayed", () => {
    expect(planBurst([entry("hola"), entry("otro", 4e3, 2)], 5e3)?.entries).toHaveLength(1);
  });
  it.each(["button", "audio", "image", "document"])("keeps %s as an ordered barrier", (type) => {
    const barrier = entry("control", 100, 2);
    if (type === "button") barrier.message.interactionId = "enterprise_receipt";
    else barrier.message.inputType = type;
    const plan = planBurst([entry("productos"), barrier, entry("despu\xE9s", 200, 3)], 250);
    expect(plan.entries).toHaveLength(1);
    expect(plan.due).toBe(250);
    expect(planBurst([barrier, entry("despu\xE9s", 200, 3)], 250)?.entries).toEqual([barrier]);
  });
  it("splits rather than truncates overlong input", () => {
    expect(planBurst([entry("a".repeat(4e3)), entry("b".repeat(4e3), 1, 2)], 2)?.entries).toHaveLength(1);
    expect(planBurst(Array.from({ length: 21 }, (_, i) => entry("dato", i, i)), 21)?.entries).toHaveLength(20);
  });
  it("isolates channel, tenant and recipient with collision-safe keys", () => {
    const msg = message("dato");
    expect(burstKey("a", msg)).not.toBe(burstKey("b", msg));
    expect(burstKey("a", msg)).not.toBe(burstKey("a", { ...msg, phoneNumberId: "other" }));
    expect(burstKey("a", msg)).not.toBe(burstKey("a", { ...msg, to: "other" }));
  });
});
describe("durable inbox", () => {
  it("persists originals, deduplicates and postpones the alarm without processing on enqueue", async () => {
    const first = message("hola");
    const stub = env.WHATSAPP_BURSTS.getByName(burstKey("burst-test", first));
    await stub.enqueue("burst-test", first);
    await stub.enqueue("burst-test", first);
    await stub.enqueue("burst-test", message("como estas"));
    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM inbox").one().n).toBe(2);
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
      expect(state.storage.sql.exec("SELECT body FROM inbox ORDER BY seq").toArray().map((row) => JSON.parse(row.body).text)).toEqual(["hola", "como estas"]);
    });
  });
  it("rejects a cross-tenant enqueue into another conversation", async () => {
    const msg = message("hola");
    const stub = env.WHATSAPP_BURSTS.getByName(burstKey("one", msg));
    expect(await stub.enqueue("two", msg)).toEqual({ accepted: false });
  });
  it("never repeats an interrupted operation and retains its payload for recovery", async () => {
    const msg = { ...message("dato"), to: "51900000002" };
    const stub = env.WHATSAPP_BURSTS.getByName(burstKey("burst-test", msg));
    await stub.enqueue("burst-test", msg);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE inbox SET status = 'executing'");
    });
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT status, body FROM inbox").one()).toMatchObject({ status: "uncertain", body: JSON.stringify(msg) });
      expect(state.storage.sql.exec("SELECT blocked FROM safety").one().blocked).toBe(1);
    });
  });
});
describe("aggregated runtime", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO tenants(id, name) VALUES ('burst-test', 'Burst')"),
      env.DB.prepare(`INSERT OR IGNORE INTO bot_configs(tenant_id, system_prompt, ai_provider, ai_model, temperature, max_tokens, role_key)
        VALUES ('burst-test', 'Prueba', 'groq', 'llama-3.1-8b-instant', 0, 200, 'cat')`),
      env.DB.prepare("INSERT OR IGNORE INTO whatsapp_numbers(id, tenant_id, phone_number_id) VALUES ('burst-number', 'burst-test', '444444444444444')")
    ]);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("ACKs a signed webhook after durable admission, before any model request", async () => {
    const enabled = { ...env, META_APP_SECRET: "test-burst-secret" };
    Object.defineProperty(enabled, "WHATSAPP_BURST_ENABLED", { value: "true" });
    const msg = { ...message("hola"), to: "51900000003" };
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{
      field: "messages",
      value: { metadata: { phone_number_id: msg.phoneNumberId }, messages: [{
        id: msg.id,
        from: msg.to,
        type: "text",
        text: { body: msg.text }
      }] }
    }] }] });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(enabled.META_APP_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
    const ctx = createExecutionContext();
    const fetchSpy = vi.fn(async () => {
      throw new Error("Must not call a provider on admission");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const response = await worker.fetch(new Request("https://test/webhooks/whatsapp", {
      method: "POST",
      body,
      headers: { "X-Hub-Signature-256": `sha256=${signature}` }
    }), enabled, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const stub = env.WHATSAPP_BURSTS.getByName(burstKey("burst-test", msg));
    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE status = 'pending'").one().n).toBe(1);
    });
  });
  it("executes a durable alarm once for a joined burst and erases successful payloads", async () => {
    const messages = [message("hola"), message("como estas")].map((msg) => ({ ...msg, to: "51900000004" }));
    const stub = env.WHATSAPP_BURSTS.getByName(burstKey("burst-test", messages[0]));
    for (const msg of messages) await stub.enqueue("burst-test", msg);
    await runInDurableObject(stub, async (instance, state) => {
      let calls = 0;
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        if (String(url).includes("api.groq.com")) {
          calls++;
          return Response.json({ choices: [{ message: { content: "Todo bien" } }] });
        }
        return Response.json({ messages: [{ id: "out-alarm" }] });
      }));
      state.storage.sql.exec("UPDATE inbox SET received = ?", Date.now() - 5e3);
      await instance.alarm();
      await instance.alarm();
      expect(calls).toBe(1);
      expect(state.storage.sql.exec("SELECT status, body FROM inbox").toArray()).toEqual([{ status: "done", body: null }, { status: "done", body: null }]);
      vi.unstubAllGlobals();
    });
  });
  it("keeps a message arriving during inference pending instead of running another turn", async () => {
    const first = { ...message("primer mensaje"), to: "51900000006" };
    const stub = env.WHATSAPP_BURSTS.getByName(burstKey("burst-test", first));
    await stub.enqueue("burst-test", first);
    await runInDurableObject(stub, async (instance, state) => {
      let release;
      let started;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const beginning = new Promise((resolve) => {
        started = resolve;
      });
      let calls = 0;
      vi.stubGlobal("fetch", vi.fn(async (url) => {
        if (String(url).includes("api.groq.com")) {
          calls++;
          started();
          await gate;
          return Response.json({ choices: [{ message: { content: "Respuesta" } }] });
        }
        return Response.json({ messages: [{ id: "out-concurrent" }] });
      }));
      state.storage.sql.exec("UPDATE inbox SET received = ?", Date.now() - 5e3);
      const processing = instance.alarm();
      await beginning;
      await instance.enqueue("burst-test", { ...message("dato posterior"), to: first.to });
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE status = 'pending'").one().n).toBe(1);
      expect(calls).toBe(1);
      release();
      await processing;
      expect(calls).toBe(1);
      vi.unstubAllGlobals();
    });
  });
  it("does not truncate a combined prompt after the old per-message 4000-character limit", async () => {
    let prompt = "";
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (String(url).includes("api.groq.com")) {
        prompt = JSON.parse(String(options?.body)).messages.at(-1).content;
        return Response.json({ choices: [{ message: { content: "Respuesta" } }] });
      }
      return Response.json({ messages: [{ id: "out-long" }] });
    }));
    await processConversationTurn([message("a".repeat(3900)), message("b".repeat(2e3))], env, "burst-test");
    expect(prompt).toHaveLength(5901);
    expect(prompt.endsWith("b".repeat(2e3))).toBe(true);
  });
  it("blocks fiscal creation after an interrupted turn even with a button", async () => {
    await env.DB.prepare("UPDATE bot_configs SET role_key = 'enterprise-advisor' WHERE tenant_id = 'burst-test'").run();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (!String(url).includes("graph.facebook.com")) throw new Error("No fiscal or model request allowed");
      calls.push(String(options?.body));
      return Response.json({ messages: [{ id: "out-blocked" }] });
    }));
    await processConversationTurn([{ ...message("Crear"), interactionId: "enterprise_issue_invoice:old" }], env, "burst-test", true);
    expect(calls.some((body) => body.includes("bloqueada por seguridad"))).toBe(true);
    await env.DB.prepare("UPDATE bot_configs SET role_key = 'cat' WHERE tenant_id = 'burst-test'").run();
  });
  it("makes one model request for five fragments and stores each original once", async () => {
    let requests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (String(url).includes("api.groq.com")) {
        requests++;
        expect(String(options?.body)).toContain("hola\\ncomo\\nestas\\nquiero factura\\n25 chalecos total 900");
        return Response.json({ choices: [{ message: { content: "Respuesta conjunta" } }] });
      }
      if (String(url).includes("graph.facebook.com")) return Response.json({ messages: [{ id: "out-test" }] });
      throw new Error("Unexpected external request");
    }));
    const messages = ["hola", "como", "estas", "quiero factura", "25 chalecos total 900"].map((text) => ({ ...message(text), to: "51900000005" }));
    await processConversationTurn(messages, env, "burst-test");
    expect(requests).toBe(1);
    const rows = await env.DB.prepare("SELECT content FROM messages WHERE tenant_id = 'burst-test' AND conversation_id = 'burst-test:51900000005' AND direction = 'inbound' ORDER BY id").all();
    expect(rows.results.map((row) => row.content)).toEqual(messages.map((msg) => msg.text));
    await processConversationTurn(messages, env, "burst-test");
    expect(requests).toBe(1);
  });
});
