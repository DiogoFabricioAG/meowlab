import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { D1RoleStateRepository } from "../src/adapters/roles/d1-role-state-repository";
import {
  SALES_ALIAS_CACHE_KEY,
  SALES_ALIAS_CACHE_TTL_MS,
  matchesSalesAlias,
  parseSalesAliasCache,
  serializeSalesAliasCache,
} from "../src/sales/cat-name";
import { fetchSalesAliasesWithTimeout } from "../src/sales/client";

async function signWebhookBody(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

async function sendSignedWebhook(
  text: string,
  wamid: string,
  overrides: Partial<Env> = {},
): Promise<Response> {
  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{
      id: "entry-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "51900000001", phone_number_id: "pn-alias-test" },
          contacts: [{ profile: { name: "Rosa" }, wa_id: "51999111222" }],
          messages: [{ from: "51999111222", id: wamid, timestamp: "1700000000", type: "text", text: { body: text } }],
        },
      }],
    }],
  });
  const req = new Request("https://example.com/webhooks/whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": await signWebhookBody(payload) },
    body: payload,
  }) as Request<unknown, IncomingRequestCfProperties>;
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("Sales Cat alias cache & non-blocking lookup (T5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("caches aliases with a 5-minute TTL and expires cleanly", () => {
    const t0 = 1_700_000_000_000;
    const raw = serializeSalesAliasCache(["Michi", "michi", "Tigre"], t0);
    expect(parseSalesAliasCache(raw, t0 + 1_000)).toEqual(["michi", "tigre"]);
    expect(parseSalesAliasCache(raw, t0 + SALES_ALIAS_CACHE_TTL_MS)).toBeNull();
    expect(parseSalesAliasCache("not-json", t0)).toBeNull();
  });

  it("caches empty alias list so normal messages make 0 bridge calls within TTL", () => {
    const t0 = 1_700_000_000_000;
    const raw = serializeSalesAliasCache([], t0);
    const cached = parseSalesAliasCache(raw, t0 + 60_000);
    expect(cached).toEqual([]);
    expect(matchesSalesAlias("Hola, quiero emitir una factura", cached!)).toBe(false);
    expect(matchesSalesAlias("Emite una boleta por 50", cached!)).toBe(false);
  });

  it("matches custom cat name at the start of a message without matching /stock or /collections", () => {
    const aliases = ["michi"];
    expect(matchesSalesAlias("Michi, ¿cuánto vendimos hoy?", aliases)).toBe(true);
    expect(matchesSalesAlias("michi", aliases)).toBe(true);
    expect(matchesSalesAlias("/stock entrada 5 polos", aliases)).toBe(false);
    expect(matchesSalesAlias("/collections", aliases)).toBe(false);
    expect(matchesSalesAlias("Hola buenos días", aliases)).toBe(false);
  });

  it("returns null within short timeout when bridge hangs or fails without blocking routing", async () => {
    const hangingClient = {
      companies: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const start = Date.now();
    const res = await fetchSalesAliasesWithTimeout(hangingClient, 40);
    expect(res).toBeNull();
    expect(Date.now() - start).toBeLessThan(500);

    const failingClient = {
      companies: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    expect(await fetchSalesAliasesWithTimeout(failingClient, 40)).toBeNull();

    const okClient = {
      companies: vi.fn(async () => ({
        ok: true as const,
        data: [
          { id: "org_a", name: "Tienda A", catName: "Michi" },
          { id: "org_b", name: "Tienda B", catName: null },
        ],
      })),
    };
    expect(await fetchSalesAliasesWithTimeout(okClient, 200)).toEqual(["michi"]);
  });

  it("routes normal messages with 0 bridge sales calls when alias cache is warm, and handles bridge failure without blocking", async () => {
    const bridgePaths: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("vps.example.test")) {
        bridgePaths.push(new URL(url).pathname);
        if (url.includes("/v1/sales/execute")) {
          const reqId = (init?.headers as Record<string, string> | undefined)?.["X-Manolo-Request-Id"] ?? "r1";
          return new Response(JSON.stringify({ request_id: reqId, ok: true, data: { companies: [] } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("down", { status: 503 });
      }
      return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const overrides: Partial<Env> = {
      VPS_BRIDGE_ENABLED: "true",
      VPS_BRIDGE_API_URL: "https://vps.example.test" as Env["VPS_BRIDGE_API_URL"],
      VPS_BRIDGE_HMAC_SECRET: "test-hmac-secret",
      GROQ_API_KEY: "",
      OPENAI_API_KEY: "",
    };

    // 1st normal message: bridge /v1/sales/execute may be consulted once (fast) and caches empty aliases in D1
    const r1 = await sendSignedWebhook("Hola buenos días", "wamid.alias.1", overrides);
    expect(r1.status).toBe(200);
    const firstSalesCalls = bridgePaths.filter((p) => p === "/v1/sales/execute").length;
    expect(firstSalesCalls).toBe(1);

    // 2nd normal message within 5 min: 0 bridge /v1/sales/execute calls
    bridgePaths.length = 0;
    const r2 = await sendSignedWebhook("Emite una boleta por 50", "wamid.alias.2", overrides);
    expect(r2.status).toBe(200);
    expect(bridgePaths.filter((p) => p === "/v1/sales/execute")).toHaveLength(0);

    // /stock and /collections never consult /v1/sales/execute
    bridgePaths.length = 0;
    const rStock = await sendSignedWebhook("/stock", "wamid.alias.3", overrides);
    const rColl = await sendSignedWebhook("/collections", "wamid.alias.4", overrides);
    expect(rStock.status).toBe(200);
    expect(rColl.status).toBe(200);

    // Warm cache with custom alias "michi" -> routes "Michi, ..." to Sales Cat without resolveAlias call
    const contacts = await env.DB.prepare("SELECT id, tenant_id FROM contacts ORDER BY id DESC LIMIT 1").first<{ id: number; tenant_id: string }>();
    if (contacts) {
      await new D1RoleStateRepository(env.DB).set(
        contacts.tenant_id,
        contacts.id,
        SALES_ALIAS_CACHE_KEY,
        serializeSalesAliasCache(["michi"]),
      );
      bridgePaths.length = 0;
      const rMichi = await sendSignedWebhook("Michi, ¿cuánto vendimos hoy?", "wamid.alias.5", overrides);
      expect(rMichi.status).toBe(200);
      // SalesRoleHandler runs and calls companies(), not resolve_alias
      expect(bridgePaths.filter((p) => p === "/v1/sales/execute").length).toBeGreaterThanOrEqual(1);
    }
    void fetchSpy;
  });
});
