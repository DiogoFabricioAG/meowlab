/**
 * Node entry for the VPS (ADR-0006): the same API and auth as the Cloudflare entry,
 * with PostgreSQL instead of D1 and the built UI served from ./dist. Behind Caddy.
 */
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import pg from "pg";
import { createApp } from "./app";
import { createAuth, googleEnabled, type AuthSettings } from "./auth";
import { createPortalBridge } from "./bridge";
import { postgresAdminMetrics } from "./admin-metrics";
import { MercadoPagoClient } from "./billing/mercadopago";
import { BillingService } from "./billing/service";
import { PgBillingStore } from "./billing/store";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Docker secrets arrive as files: NAME_FILE wins over NAME. */
function secret(name: string, optional = false): string | undefined {
  const path = process.env[`${name}_FILE`]?.trim();
  const value = path ? readFileSync(path, "utf8").trim() : process.env[name]?.trim();
  if (!value && !optional) throw new Error(`Missing required secret: ${name} or ${name}_FILE`);
  return value || undefined;
}

/** Applies the "/*" block of the same _headers file Cloudflare uses, so both runtimes send identical headers. */
function securityHeaders(path: string): Array<[string, string]> {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const headers: Array<[string, string]> = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      inBlock = line.trim() === "/*";
      continue;
    }
    const separator = line.indexOf(":");
    if (inBlock && separator > 0) headers.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return headers;
}

const settings: AuthSettings = {
  BETTER_AUTH_URL: required("BETTER_AUTH_URL"),
  BETTER_AUTH_SECRET: secret("BETTER_AUTH_SECRET")!,
  GOOGLE_CLIENT_ID: secret("GOOGLE_CLIENT_ID", true),
  GOOGLE_CLIENT_SECRET: secret("GOOGLE_CLIENT_SECRET", true),
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
};
if (settings.BETTER_AUTH_SECRET.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");

const pool = new pg.Pool({
  host: required("DATABASE_HOST"),
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: required("DATABASE_NAME"),
  user: required("DATABASE_USER"),
  password: secret("DATABASE_PASSWORD"),
  max: 10,
  idleTimeoutMillis: 30_000,
  application_name: "meowlab-app",
});

// Caddy overwrites X-Forwarded-For for untrusted clients, so the first entry is the real client.
const auth = createAuth(pool, settings, ["x-forwarded-for"]);
const allowedOrigins = [settings.BETTER_AUTH_URL, ...(settings.TRUSTED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)];
// Billing (ADR-0007): on only when the Mercado Pago token exists. Without the webhook
// secret, notifications are refused and the return page plus the periodic
// reconciliation keep subscriptions in sync.
const mercadopagoToken = secret("MERCADOPAGO_ACCESS_TOKEN", true);
const bridge = createPortalBridge(process.env.BRIDGE_URL, secret("PORTAL_BRIDGE_HMAC_SECRET", true));
const billingStore = new PgBillingStore(pool);
const billing = mercadopagoToken
  ? new BillingService(billingStore, new MercadoPagoClient(mercadopagoToken), {
      appUrl: settings.BETTER_AUTH_URL,
      webhookSecret: secret("MERCADOPAGO_WEBHOOK_SECRET", true),
      testMode: process.env.MERCADOPAGO_TEST_MODE === "true",
      log: (event, details) => console.log(JSON.stringify({ event, ...details })),
      // Per company billing: a paid period switches the agents on in that company.
      entitlements: bridge?.entitlements
        ? { apply: async (tenantId, agents, until) => (await bridge.entitlements!(tenantId, agents, until))?.status === "ok" }
        : undefined,
    })
  : undefined;
if (billing) {
  const reconcile = () => void billing.reconcileAll().catch(() => console.log(JSON.stringify({ event: "billing_reconcile_failed" })));
  setTimeout(reconcile, 60_000).unref();
  setInterval(reconcile, 60 * 60_000).unref();
}

const api = createApp({
  auth,
  googleEnabled: googleEnabled(settings),
  bridge,
  allowedOrigins,
  adminMetrics: postgresAdminMetrics((sql, values) => pool.query(sql, values), billing ? () => billingStore.metrics() : undefined),
  billing,
  users: async (ids) => {
    const { rows } = await pool.query('SELECT id, name, email FROM "user" WHERE id = ANY($1::text[])', [ids]);
    return new Map(rows.map((row) => [String(row.id), { name: String(row.name), email: String(row.email) }]));
  },
  appUrl: settings.BETTER_AUTH_URL,
});

const distDir = process.env.DIST_DIR ?? "./dist";
const headers = securityHeaders(`${distDir}/_headers`);
const app = new Hono();
app.use("*", async (c, next) => {
  await next();
  for (const [name, value] of headers) c.header(name, value);
});
app.get("/healthz", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.json({ status: "ok" });
  } catch {
    return c.json({ status: "unavailable" }, 503);
  }
});
app.route("/", api);
app.use("/*", serveStatic({ root: distDir }));
// Single-page app: any other path renders the UI.
app.get("*", serveStatic({ path: `${distDir}/index.html` }));

const port = Number(process.env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(JSON.stringify({ event: "meowlab_app_started", port }));
});

const shutdown = () => {
  server.close();
  void pool.end();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
