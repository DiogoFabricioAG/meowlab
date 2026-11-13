import fs from "node:fs/promises";

const origin = "https://whatsapp-webhook-meta-production.diogofabricio17.workers.dev";
const report = {};
let token;
async function call(path, method = "GET", body) {
  const response = await fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
}
function expect(condition, stage) { if (!condition) throw Error(`RADAR smoke failed at ${stage}`); }
try {
  const health = await call("/health");
  expect(health.status === 200 && health.data?.status === "ok", "health");
  report.health = 200;
  const webhook = await call("/webhooks/whatsapp", "POST", { object: "whatsapp_business_account", entry: [] });
  expect(webhook.status === 401, "unsigned_webhook");
  report.unsignedWebhook = 401;
  const unauthorized = await call("/v1/projects/radar/status");
  expect(unauthorized.status === 401, "unauthorized");
  report.unauthorized = 401;
  const registration = await call("/v1/projects/radar/installations", "POST");
  expect(registration.status === 201 && /^[a-f0-9]{64}$/.test(registration.data?.token), "registration");
  token = registration.data.token;
  report.registration = 201;
  const url = new URL(registration.data.whatsappUrl);
  expect(url.protocol === "https:" && url.hostname === "wa.me", "link");
  report.linkCreated = true; // Do not print the one-time linking code or token.
  const status = await call("/v1/projects/radar/status");
  expect(status.status === 200 && status.data?.linked === false && status.data?.open === false, "unbound_status");
  report.unboundStatus = { linked: false, open: false };
  const blocked = await call("/v1/projects/radar/alerts", "POST", {
    ocid: "radar-operational-smoke-unbound", code: "PRUEBA OPERATIVA SIN VINCULACION",
    description: "Prueba de control de acceso; no representa una convocatoria ni debe enviarse.",
    buyer: "Fixture de prueba", amount: "No aplica", deadline: "No aplica",
    sourceUrl: "https://contratacionesabiertas.oece.gob.pe",
  });
  expect(blocked.status === 403 && blocked.data?.error === "not_linked", "unbound_alert");
  report.unboundAlertBlocked = 403;
} finally {
  if (token) {
    const revoke = await call("/v1/projects/radar/revoke", "POST");
    expect(revoke.status === 200 && revoke.data?.revoked, "revoke");
    report.revokedTestInstallation = true;
    const revoked = await call("/v1/projects/radar/status");
    expect(revoked.status === 401, "revoked_credential");
    report.revokedCredential = 401;
    token = undefined;
  }
}
report.realMessageTested = false;
if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
