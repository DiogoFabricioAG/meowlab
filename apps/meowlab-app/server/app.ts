import { Hono, type Context } from "hono";
import type { Auth } from "./auth";
import type { PortalBridge, PortalLinkAction } from "./bridge";
import type { AdminMetricsSource } from "./admin-metrics";
import type { BillingService } from "./billing/service";

export type PortalModule = {
  key: string;
  title: string;
  status: "needs_whatsapp" | "available" | "coming_soon";
};

export type AppDeps = {
  auth: Auth;
  googleEnabled: boolean;
  /** Null until the bridge URL and the portal secret are configured. */
  bridge: PortalBridge | null;
  /** Origins allowed to send state-changing requests with the session cookie. */
  allowedOrigins: readonly string[];
  /** Aggregated portal metrics for administrators; absent where not implemented (local D1). */
  adminMetrics?: AdminMetricsSource;
  /** Subscriptions with Mercado Pago (ADR-0007); absent where not configured. */
  billing?: BillingService;
};

const isAdmin = (session: Session) => (session.user as { role?: unknown }).role === "admin";

type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP API of the portal. Runtime-agnostic: the Cloudflare and Node entries only build its dependencies. */
export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: { session: Session } }>();

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  app.get("/api/health", (c) => c.json({ status: "ok", service: "meowlab-app" }));

  app.get("/api/config", (c) =>
    c.json({
      google: deps.googleEnabled,
      // Needs an e-mail provider; decided before production (ADR-0006).
      passwordReset: false,
      whatsappLinking: deps.bridge !== null,
    }),
  );

  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  // Public: Mercado Pago calls it. Trust comes from the signature and a fresh read of
  // the resource from the API, never from the body.
  app.post("/api/webhooks/mercadopago", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const raw = await c.req.text();
    if (raw.length > 64 * 1024) return c.json({ error: "too_large" }, 413);
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    const result = await deps.billing.webhook({
      query: new URL(c.req.url).searchParams,
      signature: c.req.header("x-signature") ?? null,
      requestId: c.req.header("x-request-id") ?? null,
      body,
    });
    return c.json({ outcome: result.outcome }, result.status as 200);
  });

  // Everything below needs a session; writes also need a same-site Origin (Better Auth
  // checks its own routes, these are ours).
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && !deps.allowedOrigins.includes(c.req.header("Origin") ?? "")) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthenticated" }, 401);
    c.set("session", session);
    await next();
  });

  app.get("/api/me", async (c) => {
    const { user } = c.get("session");
    const link = deps.bridge ? await deps.bridge.link(user.id, { action: "status" }) : null;
    const linked = link?.status === "linked";
    const modules: PortalModule[] = [
      // Billing data arrives in phase 3; until then a linked number shows it as coming soon.
      { key: "billing", title: "Facturación electrónica", status: linked ? "coming_soon" : "needs_whatsapp" },
    ];
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      isAdmin: isAdmin(c.get("session")),
      whatsapp: linked
        ? { linked: true, maskedPhone: link.maskedPhone, linkedAt: link.linkedAt, available: true }
        : { linked: false, available: deps.bridge !== null && link !== null },
      modules,
    });
  });

  const relay = async (c: Context<{ Variables: { session: Session } }>, request: PortalLinkAction) => {
    if (!deps.bridge) return c.json({ error: "linking_unavailable" }, 503);
    const result = await deps.bridge.link(c.get("session").user.id, request);
    return result ? c.json(result) : c.json({ error: "linking_unavailable" }, 503);
  };

  app.post("/api/whatsapp/start", async (c) => {
    const body = await c.req.json().catch(() => null) as { phone?: unknown } | null;
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    if (!phone || phone.length > 32) return c.json({ status: "invalid_phone" });
    return relay(c, { action: "start", phone });
  });

  app.post("/api/whatsapp/verify", async (c) => {
    const body = await c.req.json().catch(() => null) as { challengeId?: unknown; code?: unknown } | null;
    const challengeId = typeof body?.challengeId === "string" ? body.challengeId : "";
    const code = typeof body?.code === "string" ? body.code.replace(/\s/g, "") : "";
    if (!UUID.test(challengeId) || !/^\d{6}$/.test(code)) return c.json({ status: "invalid_code", attemptsLeft: null });
    return relay(c, { action: "verify", challengeId, code });
  });

  app.post("/api/whatsapp/unlink", (c) => relay(c, { action: "unlink" }));

  app.get("/api/billing", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    return c.json(await deps.billing.status(c.get("session").user.id));
  });

  app.post("/api/billing/subscribe", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const body = await c.req.json().catch(() => null) as { agents?: unknown; payerEmail?: unknown } | null;
    const agents = Array.isArray(body?.agents) ? body.agents.filter((a): a is string => typeof a === "string").slice(0, 10) : [];
    const payerEmail = typeof body?.payerEmail === "string" ? body.payerEmail : "";
    return c.json(await deps.billing.subscribe(c.get("session").user.id, agents, payerEmail));
  });

  app.post("/api/billing/sync", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    try {
      await deps.billing.syncFor(c.get("session").user.id);
    } catch {
      return c.json({ error: "provider_unavailable" }, 503);
    }
    return c.json(await deps.billing.status(c.get("session").user.id));
  });

  app.post("/api/billing/cancel", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    try {
      return c.json({ status: await deps.billing.cancel(c.get("session").user.id) });
    } catch {
      return c.json({ error: "provider_unavailable" }, 503);
    }
  });

  // The role comes from the database on every request (getSession reads the user row),
  // so revoking it takes effect immediately.
  app.get("/api/admin/metrics", async (c) => {
    if (!isAdmin(c.get("session"))) return c.json({ error: "forbidden" }, 403);
    if (!deps.adminMetrics) return c.json({ error: "metrics_unavailable" }, 503);
    try {
      return c.json(await deps.adminMetrics());
    } catch {
      return c.json({ error: "metrics_unavailable" }, 503);
    }
  });

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  return app;
}
