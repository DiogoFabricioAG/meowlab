// Read-only baseline/post-deploy comparison. No credential values in output.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "backups/multimodal-20261106");
const mode = process.argv[2] ?? "before";
if (!["before", "after"].includes(mode)) throw Error("Unknown verification mode");
const expected = mode === "before" ? "85802e7f-99bb-4907-a4df-101fedb2388c" : process.argv[3];
if (!expected) throw Error("Expected version missing");
const auth = await fs.readFile(path.join(os.homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml"), "utf8");
const token = auth.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1];
if (!token) throw Error("Authentication unavailable");
const endpoint = "https://api.cloudflare.com/client/v4/accounts/425570893cf14d98277348565ec23eae/workers/scripts/whatsapp-webhook-meta-production";
async function get(suffix) {
  const response = await fetch(endpoint + suffix, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Error(`Worker verification HTTP ${response.status}`);
  return (await response.json()).result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function bindingIdentity(binding) {
  return { name: binding.name, type: binding.type,
    ...(binding.type === "plain_text" ? { text: binding.text } : {}),
    ...(binding.type === "d1" ? { database: binding.database_id ?? binding.id } : {}),
    ...(binding.type === "r2_bucket" ? { bucket: binding.bucket_name } : {}),
    ...(binding.type === "durable_object_namespace" ? { namespace: binding.namespace_id, class: binding.class_name, script: binding.script_name } : {}),
    ...(binding.type === "browser" ? { version: binding.version } : {}) };
}
function contract(settings) {
  return canonical({ compatibility_date: settings.compatibility_date, flags: settings.compatibility_flags,
    observability: settings.observability, logpush: settings.logpush, tail_consumers: settings.tail_consumers,
    bindings: settings.bindings.map(bindingIdentity).sort((a, b) => a.name.localeCompare(b.name)) });
}
const [settings, deployments, schedules, subdomain] = await Promise.all([get("/settings"), get("/deployments"), get("/schedules"), get("/subdomain")]);
const active = deployments.deployments[0].versions;
if (active.length !== 1 || active[0].percentage !== 100 || active[0].version_id !== expected) throw Error("Active version drift");
const baseline = JSON.parse(await fs.readFile(path.join(directory, "before/worker/settings.json"), "utf8"));
const baselineSchedules = JSON.parse(await fs.readFile(path.join(directory, "before/worker/schedules.json"), "utf8"));
if (JSON.stringify(contract(settings)) !== JSON.stringify(contract(baseline))) throw Error("Bindings, variables, secrets or compatibility changed");
const crons = schedules.schedules.map((item) => item.cron).sort();
if (JSON.stringify(crons) !== JSON.stringify(baselineSchedules.schedules.map((item) => item.cron).sort())) throw Error("Cron changed");
if (subdomain.enabled !== true || subdomain.previews_enabled !== true) throw Error("Workers.dev configuration changed");
const result = { version: expected, bindingContractPreserved: true, compatibilityPreserved: true, schedules: crons,
  burstEnabled: settings.bindings.find((binding) => binding.name === "WHATSAPP_BURST_ENABLED")?.text,
  health: (await fetch("https://whatsapp-webhook-meta-production.diogofabricio17.workers.dev/health")).status };
if (result.health !== 200) throw Error("Public Worker health failed");
const bridgeResult = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "meowlab",
  "docker inspect manolo-platform-bridge-1"], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
if (bridgeResult.error || bridgeResult.status !== 0) throw Error("Bridge inventory failed");
const bridge = JSON.parse(bridgeResult.stdout)[0];
const previousBridge = JSON.parse(await fs.readFile(path.join(directory, "before/bridge/inventory.json"), "utf8"));
if (bridge.Image !== previousBridge.image || bridge.State.Health?.Status !== "healthy") throw Error("Bridge image or health changed");
result.bridgeImage = bridge.Image;
result.bridgeHealthy = true;
await fs.mkdir(path.join(directory, mode), { recursive: true });
await fs.writeFile(path.join(directory, mode, "worker-verification.json"), JSON.stringify(result, null, 2));
if (mode === "after") for (const [name, value] of Object.entries({ settings, deployments, schedules, subdomain })) {
  await fs.writeFile(path.join(directory, mode, `${name}.json`), JSON.stringify(value, null, 2));
}
if (mode === "after") {
  const response = await fetch(endpoint + "/content/v2", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Error("Cannot snapshot active code");
  for (const [name, file] of await response.formData()) {
    if (typeof file === "string") continue;
    const filename = file.name || name;
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) throw Error("Unexpected active module path");
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(directory, mode, filename), bytes);
    if (filename === "index.js") {
      const checked = await fs.readFile(path.join(directory, "release/worker-dry-run/index.js"));
      if (!bytes.equals(checked)) throw Error("Active runtime differs from the checked dry-run artifact");
      result.activeCodeSha256 = createHash("sha256").update(bytes).digest("hex");
      result.activeCodeMatchesDryRun = true;
    }
  }
  if (!result.activeCodeMatchesDryRun) throw Error("Active module not found");
  await fs.writeFile(path.join(directory, mode, "worker-verification.json"), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
