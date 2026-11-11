import { Hono } from "hono";
import type { Auth } from "./auth";

export type PortalModule = {
  key: string;
  title: string;
  status: "needs_whatsapp" | "available" | "coming_soon";
};

export type AppDeps = {
  auth: Auth;
  googleEnabled: boolean;
};

/** HTTP API of the portal. Runtime-agnostic: the Cloudflare and Node entries only build its dependencies. */
export function createApp(deps: AppDeps) {
  const app = new Hono();

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
    }),
  );

  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  app.get("/api/me", async (c) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthenticated" }, 401);
    const { user } = session;
    // WhatsApp linking arrives in phase 2; until then no role data is reachable.
    const modules: PortalModule[] = [
      { key: "billing", title: "Facturación electrónica", status: "needs_whatsapp" },
    ];
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      whatsapp: { linked: false },
      modules,
    });
  });

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  return app;
}
