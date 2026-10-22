import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";

const options = new Map();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--verified-facturaya") options.set(args[i], true);
  else options.set(args[i], args[++i]);
}
const action = options.get("--action") || "inspect";
const tenantId = options.get("--tenant");
const contactId = Number(options.get("--contact"));
if (!tenantId || !Number.isSafeInteger(contactId) || contactId <= 0 || !["inspect", "release"].includes(action)) {
  throw Error("Use --tenant TENANT --contact ID --action inspect|release");
}
if (action === "release" && (!options.get("--expected") || !options.get("--review-ref") || !options.get("--verified-facturaya"))) {
  throw Error("Release requires --expected FINGERPRINT --review-ref TICKET --verified-facturaya; verify FacturaYa first");
}
const endpoint = new URL(options.get("--url") || "https://whatsapp-webhook-meta-production.diogofabricio17.workers.dev/internal/conversations/burst-admin");
if (endpoint.protocol !== "https:" || endpoint.hostname !== "whatsapp-webhook-meta-production.diogofabricio17.workers.dev"
  || endpoint.pathname !== "/internal/conversations/burst-admin") throw Error("Unexpected admin endpoint");
const secret = readFileSync("/run/secrets/vps_bridge_hmac_secret", "utf8").trim();
const requestId = options.get("--request-id") || `burst-admin-${randomUUID()}`;
const body = JSON.stringify({ action, requestId, tenantId, contactId,
  ...(action === "release" ? { expected: options.get("--expected"), reviewRef: options.get("--review-ref"), verifiedFacturaya: true } : {}) });
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
const response = await fetch(endpoint, { method: "POST", body, signal: AbortSignal.timeout(20000), headers: {
  "Content-Type": "application/json", "X-Manolo-Request-Id": requestId,
  "X-Manolo-Timestamp": timestamp, "X-Manolo-Signature": `sha256=${signature}`,
} });
const result = await response.json();
console.log(JSON.stringify({ status: response.status, ...result }));
if (!response.ok) process.exitCode = 1;
