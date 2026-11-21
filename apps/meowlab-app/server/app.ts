import { Hono, type Context } from "hono";
import type { Auth } from "./auth";
import type { CollectionsSettings, PortalBillingAction, PortalBridge, PortalCompanyAction, PortalLinkAction, ReorderSettings, SupportFaqChange } from "./bridge";
import type { AdminMetricsSource } from "./admin-metrics";
import type { BillingService } from "./billing/service";
import type { TenderService } from "./tender";

export type PortalModule = {
  key: string;
  title: string;
  status: "needs_whatsapp" | "available" | "no_company" | "coming_soon";
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
  tender?: TenderService;
  /** Names and e-mails of portal accounts, to show a team (ADR-0010); absent where not implemented. */
  users?: UserDirectory;
  /** Public origin used to build invitation links. Defaults to the first allowed origin. */
  appUrl?: string;
};

export type UserDirectory = (ids: string[]) => Promise<Map<string, { name: string; email: string }>>;

const isAdmin = (session: Session) => (session.user as { role?: unknown }).role === "admin";

type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUC = /^\d{11}$/;
const TENANT = /^[A-Za-z0-9_.:-]{1,128}$/;
const INVITATION = /^[A-Za-z0-9_-]{22}$/;

/** A plain page for a quote link that cannot be opened; no scripts, no external assets. */
const quoteNotice = (status: 404 | 503) => {
  const [title, text] = status === 404
    ? ["Esta cotización no existe", "Puede que el enlace esté incompleto o que la hayan anulado. Pide uno nuevo a quien te la envió."]
    : ["No pudimos abrir la cotización", "Inténtalo otra vez en unos minutos."];
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex"><title>${title} · MeowLab</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;`
    + `background:#fff;color:#111816;font:16px/1.55 system-ui,sans-serif;padding:16px}main{max-width:28rem;text-align:center;border:1px solid #dfe7e3;`
    + `border-radius:24px;padding:32px}h1{font-size:1.5rem;margin:0 0 8px}p{margin:0;color:#5b6863}</style></head>`
    + `<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
};

/** RUC lookups per account: each one may reach a paid registry provider. */
const LOOKUP_LIMIT = 20;
const LOOKUP_WINDOW_MS = 10 * 60_000;

/** HTTP API of the portal. Runtime-agnostic: the Cloudflare and Node entries only build its dependencies. */
export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: { session: Session } }>();
  // In memory: one portal process on the VPS; a restart only resets the window.
  const limiter = (limit: number) => {
    const hits = new Map<string, number[]>();
    return (userId: string, now = Date.now()) => {
      const recent = (hits.get(userId) ?? []).filter((at) => now - at < LOOKUP_WINDOW_MS);
      if (recent.length >= limit) return false;
      recent.push(now);
      hits.set(userId, recent);
      return true;
    };
  };
  const allowLookup = limiter(LOOKUP_LIMIT);
  // Invitation codes are 128-bit; this only keeps one account from hammering the bridge.
  const allowInvitationUse = limiter(30);
  const appUrl = (deps.appUrl ?? deps.allowedOrigins[0] ?? "https://app.meowlab.tech").replace(/\/$/, "");
  const namesOf = async (ids: string[]) => {
    if (!deps.users || !ids.length) return new Map<string, { name: string; email: string }>();
    try {
      return await deps.users([...new Set(ids)]);
    } catch {
      return new Map<string, { name: string; email: string }>();
    }
  };

  const CAPACITOR_ORIGIN = "https://localhost";

  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin");
    const allowCapacitorCors = origin === CAPACITOR_ORIGIN && deps.allowedOrigins.includes(CAPACITOR_ORIGIN);

    if (c.req.method === "OPTIONS") {
      if (!allowCapacitorCors) {
        return c.json({ error: "forbidden_origin" }, 403);
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": CAPACITOR_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Expose-Headers": "set-auth-token",
          Vary: "Origin",
        },
      });
    }

    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    if (allowCapacitorCors) {
      c.header("Access-Control-Allow-Origin", CAPACITOR_ORIGIN);
      c.header("Access-Control-Expose-Headers", "set-auth-token");
      c.header("Vary", "Origin");
    }
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
  // Public: a Sales Cat quote shared by link (ADR-0011) opens as its PDF in the browser's own
  // viewer (ADR-0013). The 128-bit code is the only key; the bridge stores only its hash.
  app.get("/cotizacion/:code", async (c) => {
    const code = c.req.param("code");
    if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return quoteNotice(404);
    if (!deps.bridge?.publicQuote) return quoteNotice(503);
    const result = await deps.bridge.publicQuote(code);
    if (!result) return quoteNotice(503);
    if (result.status !== "ok") return quoteNotice(404);
    const bytes = Uint8Array.from(atob(result.pdf.contentBase64), (char) => char.charCodeAt(0));
    if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return quoteNotice(503);
    const filename = result.pdf.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        // The file never changes for a code, but the code is private: no shared caches.
        "Cache-Control": "private, max-age=86400",
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

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
    // Phase 3: the module opens when the linked number belongs to a company with FacturaYa.
    const [companies, memberships] = await Promise.all([
      linked && deps.bridge ? deps.bridge.billing(user.id, { action: "companies" }) : null,
      // ADR-0010: companies of the account itself, independent of WhatsApp.
      deps.bridge ? deps.bridge.companies(user.id, { action: "mine" }) : null,
    ]);
    const companyCount = companies?.status === "ok" && "companies" in companies ? companies.companies.length : 0;
    const modules: PortalModule[] = [
      {
        key: "billing",
        title: "Facturación electrónica",
        status: !linked ? "needs_whatsapp" : companies === null ? "coming_soon" : companyCount > 0 ? "available" : "no_company",
      },
    ];
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      isAdmin: isAdmin(c.get("session")),
      whatsapp: linked
        ? { linked: true, maskedPhone: link.maskedPhone, linkedAt: link.linkedAt, available: true }
        : { linked: false, available: deps.bridge !== null && link !== null },
      modules,
      // Null when the bridge cannot answer: the panel then skips the company step.
      companies: memberships?.status === "ok" && "companies" in memberships ? memberships.companies : null,
    });
  });

  // ADR-0010, phase 1: create a company by RUC. The bridge re-reads the registry on
  // creation and decides ownership; the portal only validates shape and relays.
  const company = async (c: Context<{ Variables: { session: Session } }>, request: PortalCompanyAction) => {
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, request);
    return result ? c.json(result) : c.json({ error: "companies_unavailable" }, 503);
  };

  app.get("/api/companies/lookup", async (c) => {
    const ruc = (c.req.query("ruc") ?? "").trim();
    if (!RUC.test(ruc)) return c.json({ status: "invalid_ruc" });
    if (!allowLookup(c.get("session").user.id)) return c.json({ status: "rate_limited" }, 429);
    return company(c, { action: "lookup", ruc });
  });

  // ADR-0010, phase 2: the owner's team and invitations. The bridge checks ownership.
  const tenantParam = (c: Context) => {
    const tenantId = c.req.param("tenantId") ?? "";
    return TENANT.test(tenantId) ? tenantId : null;
  };

  app.get("/api/companies/:tenantId/team", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const me = c.get("session").user.id;
    const result = await deps.bridge.companies(me, { action: "team", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status !== "ok" || !("team" in result)) return c.json({ status: result.status }, result.status === "forbidden" ? 403 : 200);
    const names = await namesOf(result.team.members.map((member) => member.portalUserId));
    return c.json({
      status: "ok",
      members: result.team.members.map((member) => ({
        id: member.portalUserId,
        role: member.role,
        joinedAt: member.joinedAt,
        name: names.get(member.portalUserId)?.name ?? "Cuenta de MeowLab",
        email: names.get(member.portalUserId)?.email ?? null,
        you: member.portalUserId === me,
      })),
      invitations: result.team.invitations,
    });
  });

  // «Inicio»: the week of one company the account belongs to.
  app.get("/api/companies/:tenantId/weekly", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "weekly", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status !== "ok" || !("weekly" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.weekly);
  });

  // «Inicio»: 14-day daily series and recent activity of one company the account belongs to.
  app.get("/api/companies/:tenantId/activity", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "activity", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status !== "ok" || !("activity" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.activity);
  });

  // Stock Cat (ADR-0014): stock, alerts and moves of one company the account belongs to.
  app.get("/api/companies/:tenantId/stock", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "stock_view", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status !== "ok" || !("stock" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.stock);
  });

  // Collections Cat (ADR-0015): what the company is owed; its rules change only by the owner.
  app.get("/api/companies/:tenantId/collections", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "collections_view", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status !== "ok" || !("collections" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.collections);
  });

  app.post("/api/companies/:tenantId/collections/settings", async (c) => {
    const tenantId = tenantParam(c);
    const body = await c.req.json().catch(() => null) as { change?: unknown } | null;
    const change = collectionsChange(body?.change);
    if (!tenantId || !change) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "collections_settings", tenantId, change });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden" || result.status === "owner_only") return c.json({ error: result.status }, 403);
    if (result.status === "invalid_settings") return c.json({ error: "invalid_settings" }, 400);
    if (result.status !== "ok" || !("collections" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.collections);
  });

  // Support Cat (ADR-0017): cases and frequent questions; questions edited only by the owner.
  app.get("/api/companies/:tenantId/support", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "support_view", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status !== "ok" || !("support" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.support);
  });

  app.post("/api/companies/:tenantId/support/faq", async (c) => {
    const tenantId = tenantParam(c);
    const body = await c.req.json().catch(() => null) as { faq?: unknown } | null;
    const faq = supportFaq(body?.faq);
    if (!tenantId || !faq) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "support_faq", tenantId, faq });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden" || result.status === "owner_only") return c.json({ error: result.status }, 403);
    if (result.status === "invalid_settings") return c.json({ error: "invalid_request" }, 400);
    if (result.status !== "ok" || !("support" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.support);
  });

  // Reorder Cat (ADR-0016): orders, suppliers and purchases; budget and waiting times only by the owner.
  app.get("/api/companies/:tenantId/reorder", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "reorder_view", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status !== "ok" || !("reorder" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.reorder);
  });

  app.post("/api/companies/:tenantId/reorder/settings", async (c) => {
    const tenantId = tenantParam(c);
    const body = await c.req.json().catch(() => null) as { change?: unknown } | null;
    const change = reorderChange(body?.change);
    if (!tenantId || !change) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "reorder_settings", tenantId, change });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden" || result.status === "owner_only") return c.json({ error: result.status }, 403);
    if (result.status === "invalid_settings") return c.json({ error: "invalid_settings" }, 400);
    if (result.status !== "ok" || !("reorder" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.reorder);
  });

  // Sales Cat (ADR-0011 fase 3): monthly goal and custom cat name.
  app.get("/api/companies/:tenantId/sales", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "sales_view", tenantId });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status !== "ok" || !("sales" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.sales);
  });

  app.post("/api/companies/:tenantId/sales/settings", async (c) => {
    const tenantId = tenantParam(c);
    const body = await c.req.json().catch(() => null) as { catName?: unknown; goalTargetCents?: unknown; month?: unknown } | null;
    if (!tenantId || !body || typeof body !== "object") return c.json({ error: "invalid_request" }, 400);
    const change: { catName?: string | null; goalTargetCents?: number | null; month?: string } = {};
    if (body.catName !== undefined) {
      if (body.catName !== null && (typeof body.catName !== "string" || body.catName.length > 40)) return c.json({ error: "invalid_request" }, 400);
      change.catName = body.catName;
    }
    if (body.goalTargetCents !== undefined) {
      if (body.goalTargetCents === null) {
        change.goalTargetCents = null;
      } else if (typeof body.goalTargetCents === "number" && Number.isSafeInteger(body.goalTargetCents) && body.goalTargetCents > 0 && body.goalTargetCents <= 100_000_000_000) {
        change.goalTargetCents = body.goalTargetCents;
      } else {
        return c.json({ error: "invalid_request" }, 400);
      }
    }
    if (body.month !== undefined) {
      if (typeof body.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) return c.json({ error: "invalid_request" }, 400);
      change.month = body.month;
    }
    if (change.catName === undefined && change.goalTargetCents === undefined) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "sales_settings", tenantId, change });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.status === "invalid_cat_name") return c.json({ error: "invalid_cat_name" }, 400);
    if (result.status !== "ok" || !("sales" in result)) return c.json({ error: "companies_unavailable" }, 503);
    return c.json(result.sales);
  });

  app.post("/api/companies/:tenantId/invitations", async (c) => {
    const tenantId = tenantParam(c);
    const body = await c.req.json().catch(() => null) as { access?: unknown; phone?: unknown } | null;
    const access = body?.access === "full" ? "full" : body?.access === "view" ? "view" : null;
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    if (!tenantId || !access || phone.length > 32) return c.json({ error: "invalid_request" }, 400);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "invite", tenantId, access, ...(phone ? { phone } : {}) });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status !== "invited" || !("invitation" in result)) return c.json({ status: result.status }, result.status === "forbidden" ? 403 : 200);
    const { token, ...invitation } = result.invitation as typeof result.invitation & { token: string };
    // The only time the link exists in clear: the owner copies it or sends it by WhatsApp.
    return c.json({ status: "invited", invitation: { ...invitation, url: `${appUrl}/invitacion/${token}` } });
  });

  app.post("/api/companies/:tenantId/invitations/:invitationId/revoke", async (c) => {
    const tenantId = tenantParam(c);
    const invitationId = c.req.param("invitationId");
    if (!tenantId || !UUID.test(invitationId)) return c.json({ error: "invalid_request" }, 400);
    return company(c, { action: "revoke", tenantId, invitationId });
  });

  app.post("/api/companies/:tenantId/members/:memberId/remove", async (c) => {
    const tenantId = tenantParam(c);
    const memberId = c.req.param("memberId");
    if (!tenantId || !memberId || memberId.length > 128) return c.json({ error: "invalid_request" }, 400);
    return company(c, { action: "remove", tenantId, memberId });
  });

  app.post("/api/companies/:tenantId/members/:memberId/transfer", async (c) => {
    const tenantId = tenantParam(c);
    const memberId = c.req.param("memberId")?.trim();
    if (!tenantId || !memberId || memberId.length > 128) return c.json({ error: "invalid_request" }, 400);
    return company(c, { action: "transfer", tenantId, memberId });
  });

  app.post("/api/companies/:tenantId/leave", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    return company(c, { action: "leave", tenantId });
  });

  app.get("/api/invitations/:token", async (c) => {
    const token = c.req.param("token");
    if (!INVITATION.test(token)) return c.json({ status: "invalid" });
    if (!allowInvitationUse(c.get("session").user.id)) return c.json({ status: "rate_limited" }, 429);
    if (!deps.bridge) return c.json({ error: "companies_unavailable" }, 503);
    const result = await deps.bridge.companies(c.get("session").user.id, { action: "preview", token });
    if (!result) return c.json({ error: "companies_unavailable" }, 503);
    if (result.status !== "ok" || !("invitation" in result)) return c.json({ status: result.status });
    const { invitedBy, ...invitation } = result.invitation as { invitedBy: string; companyName: string };
    const inviter = (await namesOf([invitedBy])).get(invitedBy)?.name ?? null;
    return c.json({ status: "ok", invitation: { ...invitation, invitedByName: inviter } });
  });

  app.post("/api/invitations/:token/accept", async (c) => {
    const token = c.req.param("token");
    if (!INVITATION.test(token)) return c.json({ status: "invalid" });
    if (!allowInvitationUse(c.get("session").user.id)) return c.json({ status: "rate_limited" }, 429);
    return company(c, { action: "accept", token });
  });

  app.post("/api/companies", async (c) => {
    const body = await c.req.json().catch(() => null) as { ruc?: unknown; name?: unknown; sector?: unknown; city?: unknown } | null;
    const hasRuc = body?.ruc !== undefined && body?.ruc !== null && String(body.ruc).trim() !== "";
    const ruc = typeof body?.ruc === "string" ? body.ruc.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    const sector = typeof body?.sector === "string" ? body.sector.trim().replace(/\s+/g, " ") : "";
    const city = typeof body?.city === "string" ? body.city.trim().replace(/\s+/g, " ") : "";
    if (name.length > 160 || sector.length > 80 || city.length > 80) return c.json({ error: "invalid_request" }, 400);
    if (hasRuc) {
      if (!RUC.test(ruc)) return c.json({ status: "invalid_ruc" });
      // Creation with RUC re-reads the registry too, so it shares the lookup budget.
      if (!allowLookup(c.get("session").user.id)) return c.json({ status: "rate_limited" }, 429);
      return company(c, { action: "create", ruc, ...(name ? { name } : {}), ...(sector ? { sector } : {}), ...(city ? { city } : {}) });
    }
    if (!name) return c.json({ status: "invalid_name" });
    return company(c, { action: "create", name, ...(sector ? { sector } : {}), ...(city ? { city } : {}) });
  });

  app.post("/api/companies/:tenantId/ruc", async (c) => {
    const tenantId = tenantParam(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    const body = await c.req.json().catch(() => null) as { ruc?: unknown } | null;
    const ruc = typeof body?.ruc === "string" ? body.ruc.trim() : "";
    if (!RUC.test(ruc)) return c.json({ status: "invalid_ruc" });
    if (!allowLookup(c.get("session").user.id)) return c.json({ status: "rate_limited" }, 429);
    return company(c, { action: "set_ruc", tenantId, ruc });
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

  // Plan per company (ADR-0007, 13/11/2026): members see the company's plan; only its owner
  // subscribes or cancels. Membership always comes from the bridge, never from the client.
  const companyRole = async (userId: string, tenantId: unknown): Promise<"owner" | "member" | null> => {
    if (typeof tenantId !== "string" || !TENANT.test(tenantId) || !deps.bridge) return null;
    const result = await deps.bridge.companies(userId, { action: "mine" });
    if (!result || result.status !== "ok" || !("companies" in result)) return null;
    return result.companies.find((company) => company.id === tenantId)?.role ?? null;
  };

  app.all("/api/companies/:tenantId/tender/*", async (c) => {
    if (!deps.tender || !deps.bridge) return c.json({ error: "tender_unavailable" }, 503);
    const company = c.req.param("tenantId");
    const role = await companyRole(c.get("session").user.id, company);
    if (!role) return c.json({ error: "forbidden" }, 403);
    const suffix = c.req.path.replace(/^\/api\/companies\/[^/]+\/tender\//, "");
    return deps.tender(company, suffix, c.req.raw);
  });

  app.get("/api/billing", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const tenantId = c.req.query("company");
    if (!tenantId) return c.json(await deps.billing.status(null));
    const role = await companyRole(c.get("session").user.id, tenantId);
    if (!role) return c.json({ error: "forbidden" }, 403);
    return c.json({ ...await deps.billing.status(tenantId), canManage: role === "owner" });
  });

  app.post("/api/billing/subscribe", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const body = await c.req.json().catch(() => null) as { company?: unknown; agents?: unknown; payerEmail?: unknown } | null;
    const me = c.get("session").user.id;
    if (await companyRole(me, body?.company) !== "owner") return c.json({ status: "forbidden" }, 403);
    const agents = Array.isArray(body?.agents) ? body.agents.filter((a): a is string => typeof a === "string").slice(0, 10) : [];
    const payerEmail = typeof body?.payerEmail === "string" ? body.payerEmail : "";
    return c.json(await deps.billing.subscribe(me, body!.company as string, agents, payerEmail));
  });

  app.post("/api/billing/prepay", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const body = await c.req.json().catch(() => null) as { company?: unknown; agents?: unknown; months?: unknown; payerEmail?: unknown } | null;
    const me = c.get("session").user.id;
    if (await companyRole(me, body?.company) !== "owner") return c.json({ status: "forbidden" }, 403);
    const agents = Array.isArray(body?.agents) ? body.agents.filter((a): a is string => typeof a === "string").slice(0, 10) : [];
    const months = typeof body?.months === "number" ? body.months : 0;
    const payerEmail = typeof body?.payerEmail === "string" ? body.payerEmail : "";
    return c.json(await deps.billing.createPrepaidOrder(me, body!.company as string, agents, months, payerEmail));
  });

  app.post("/api/billing/sync-order", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const body = await c.req.json().catch(() => null) as { company?: unknown; orderId?: unknown; paymentId?: unknown } | null;
    const role = await companyRole(c.get("session").user.id, body?.company);
    if (!role) return c.json({ error: "forbidden" }, 403);
    const orderId = typeof body?.orderId === "string" ? body.orderId : undefined;
    const paymentId = typeof body?.paymentId === "string" ? body.paymentId : undefined;
    try {
      await deps.billing.syncPrepaid(body!.company as string, orderId, paymentId);
    } catch {
      return c.json({ error: "provider_unavailable" }, 503);
    }
    return c.json({ ...await deps.billing.status(body!.company as string), canManage: role === "owner" });
  });

  app.post("/api/billing/sync", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const body = await c.req.json().catch(() => null) as { company?: unknown } | null;
    const role = await companyRole(c.get("session").user.id, body?.company);
    if (!role) return c.json({ error: "forbidden" }, 403);
    try {
      await deps.billing.syncFor(body!.company as string);
    } catch {
      return c.json({ error: "provider_unavailable" }, 503);
    }
    return c.json({ ...await deps.billing.status(body!.company as string), canManage: role === "owner" });
  });

  app.post("/api/billing/cancel", async (c) => {
    if (!deps.billing) return c.json({ error: "billing_unavailable" }, 503);
    const body = await c.req.json().catch(() => null) as { company?: unknown } | null;
    if (await companyRole(c.get("session").user.id, body?.company) !== "owner") return c.json({ status: "forbidden" }, 403);
    try {
      return c.json({ status: await deps.billing.cancel(body!.company as string) });
    } catch {
      return c.json({ error: "provider_unavailable" }, 503);
    }
  });

  // Phase 3 (ADR-0006): read-only billing data. The bridge decides which companies this
  // account may see from its linked WhatsApp number; the portal only relays.
  const invoicing = async (c: Context<{ Variables: { session: Session } }>, request: PortalBillingAction) => {
    if (!deps.bridge) return c.json({ error: "invoicing_unavailable" }, 503);
    const result = await deps.bridge.billing(c.get("session").user.id, request);
    if (!result) return c.json({ error: "invoicing_unavailable" }, 503);
    const codes = { not_linked: 409, forbidden: 403, not_found: 404, unavailable: 503 } as const;
    if (result.status !== "ok") return c.json({ error: result.status }, codes[result.status]);
    return c.json(result);
  };
  const tenantOf = (c: Context) => {
    const tenantId = c.req.param("tenantId") ?? "";
    return /^[A-Za-z0-9_.:-]{1,128}$/.test(tenantId) ? tenantId : null;
  };
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  app.get("/api/invoicing/companies", (c) => invoicing(c, { action: "companies" }));

  app.get("/api/invoicing/:tenantId/documents", async (c) => {
    const tenantId = tenantOf(c);
    if (!tenantId) return c.json({ error: "invalid_request" }, 400);
    const from = c.req.query("from");
    const to = c.req.query("to");
    const type = c.req.query("type");
    const page = Number(c.req.query("page") ?? "1");
    if ((from && !DATE.test(from)) || (to && !DATE.test(to)) || (type && !["01", "03", "07"].includes(type))
      || !Number.isInteger(page) || page < 1 || page > 1000) return c.json({ error: "invalid_request" }, 400);
    return invoicing(c, { action: "documents", tenantId, from: from || undefined, to: to || undefined,
      type: (type || undefined) as "01" | "03" | "07" | undefined, page });
  });

  app.get("/api/invoicing/:tenantId/summary", async (c) => {
    const tenantId = tenantOf(c);
    const year = Number(c.req.query("year"));
    if (!tenantId || !Number.isInteger(year) || year < 2020 || year > 2100) return c.json({ error: "invalid_request" }, 400);
    return invoicing(c, { action: "summary", tenantId, year });
  });

  app.get("/api/invoicing/:tenantId/despatches", async (c) => {
    const tenantId = tenantOf(c);
    const page = Number(c.req.query("page") ?? "1");
    if (!tenantId || !Number.isInteger(page) || page < 1 || page > 1000) return c.json({ error: "invalid_request" }, 400);
    return invoicing(c, { action: "despatches", tenantId, page });
  });

  // Downloads stream the file to the browser; the type comes from an allow-list, never from upstream.
  app.get("/api/invoicing/:tenantId/files/:kind/:id/:fileType", async (c) => {
    const tenantId = tenantOf(c);
    const kind = c.req.param("kind");
    const id = c.req.param("id");
    const fileType = c.req.param("fileType");
    if (!tenantId || !["invoice", "credit_note", "despatch"].includes(kind) || !/^[0-9A-Za-z]{26}$/.test(id)
      || !["pdf", "xml", "cdr"].includes(fileType) || (fileType === "pdf" && kind !== "invoice")) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!deps.bridge) return c.json({ error: "invoicing_unavailable" }, 503);
    const result = await deps.bridge.billing(c.get("session").user.id, {
      action: "file", tenantId, kind: kind as "invoice", id, fileType: fileType as "pdf",
    });
    if (!result || result.status !== "ok" || !("file" in result)) {
      const status = result?.status === "forbidden" ? 403 : result?.status === "not_found" ? 404 : 503;
      return c.json({ error: "file_unavailable" }, status);
    }
    const bytes = Uint8Array.from(atob(result.file.base64), (char) => char.charCodeAt(0));
    const contentType = fileType === "pdf" ? "application/pdf" : fileType === "xml" ? "application/xml" : "application/zip";
    const filename = result.file.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${fileType === "pdf" ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
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

const COLLECTIONS_INTS: Record<string, [number, number]> = {
  defaultDueDays: [0, 365], remindBeforeDays: [0, 30], remindEveryDays: [1, 60], maxReminders: [1, 20], windowStartHour: [0, 23], windowEndHour: [1, 24],
};

/** A Support Cat frequent question to add, edit or remove; the bridge validates it again. */
export function supportFaq(value: unknown): SupportFaqChange | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const faq = value as Record<string, unknown>;
  if (Object.keys(faq).some((key) => !["id", "question", "answer", "remove"].includes(key))) return null;
  const id = faq.id === undefined ? undefined : typeof faq.id === "string" && /^[0-9a-f-]{36}$/i.test(faq.id) ? faq.id : null;
  if (id === null) return null;
  if (faq.remove !== undefined) return faq.remove === true && id && faq.question === undefined && faq.answer === undefined ? { id, remove: true } : null;
  const text = (input: unknown, max: number) => (typeof input === "string" && input.trim() && input.length <= max ? input.trim() : null);
  const question = text(faq.question, 300);
  const answer = text(faq.answer, 1500);
  return question && answer ? { ...(id ? { id } : {}), question, answer } : null;
}

/** A Reorder Cat rules change; the bridge validates it again (the escalation after the follow-up). */
export function reorderChange(value: unknown): Partial<ReorderSettings> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length || entries.length > 3) return null;
  for (const [key, field] of entries) {
    if (key === "monthlyBudgetCents") {
      if (field !== null && !(Number.isSafeInteger(field) && Number(field) > 0 && Number(field) <= 100_000_000_000)) return null;
    } else if (key === "followupHours") {
      if (!Number.isInteger(field) || Number(field) < 1 || Number(field) > 168) return null;
    } else if (key === "escalateHours") {
      if (!Number.isInteger(field) || Number(field) < 2 || Number(field) > 336) return null;
    } else {
      return null;
    }
  }
  return value as Partial<ReorderSettings>;
}

/** A Collections Cat rules change from the Plan page; the bridge validates it again. */
export function collectionsChange(value: unknown): Partial<CollectionsSettings> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length || entries.length > 11) return null;
  const change: Record<string, unknown> = {};
  for (const [key, field] of entries) {
    const range = COLLECTIONS_INTS[key];
    if (range) {
      if (!Number.isInteger(field) || Number(field) < range[0] || Number(field) > range[1]) return null;
    } else if (key === "skipSundays") {
      if (typeof field !== "boolean") return null;
    } else if (key === "yapePhone" || key === "plinPhone") {
      if (field !== null && !(typeof field === "string" && /^9[0-9]{8}$/.test(field))) return null;
    } else if (key === "bankText") {
      if (field !== null && !(typeof field === "string" && field.trim().length > 0 && field.length <= 300)) return null;
    } else if (key === "paymentLink") {
      if (field !== null && !(typeof field === "string" && field.length <= 500 && /^https:\/\/\S+$/.test(field))) return null;
    } else {
      return null;
    }
    change[key] = typeof field === "string" ? field.trim() : field;
  }
  return change as Partial<CollectionsSettings>;
}
