// Read-only operational backup. Authentication never leaves this process output.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "backups/burst-activation-20261022/actual-worker");
const auth = await fs.readFile(path.join(os.homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml"), "utf8");
const token = auth.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1];
if (!token) throw Error("Wrangler OAuth session unavailable");
const endpoint = "https://api.cloudflare.com/client/v4/accounts/425570893cf14d98277348565ec23eae/workers/scripts/whatsapp-webhook-meta-production";
async function get(suffix) {
  const response = await fetch(endpoint + suffix, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Error(`Cloudflare read HTTP ${response.status}`);
  return response;
}
await fs.mkdir(output, { recursive: true });
const content = await (await get("/content/v2")).formData();
const modules = {};
for (const [name, file] of content) {
  if (typeof file === "string") continue;
  const relative = file.name || name;
  const destination = path.resolve(output, relative);
  if (!destination.startsWith(output + path.sep)) throw Error("Unsafe snapshot path");
  const bytes = new Uint8Array(await file.arrayBuffer());
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  modules[relative] = createHash("sha256").update(bytes).digest("hex");
}
const settings = (await (await get("/settings")).json()).result;
const deployments = (await (await get("/deployments")).json()).result;
await fs.writeFile(path.join(output, "settings.json"), JSON.stringify(settings, null, 2));
await fs.writeFile(path.join(output, "deployments.json"), JSON.stringify(deployments, null, 2));
console.log(JSON.stringify({ snapshot: "backups/burst-activation-20261022/actual-worker", modules,
  versions: deployments.deployments?.[0]?.versions }));
