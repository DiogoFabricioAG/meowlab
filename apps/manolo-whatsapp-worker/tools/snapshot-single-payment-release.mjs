// Read-only remote inventory and private local backup; never publishes or restarts.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "backups/single-payment-20261106/before");
const auth = await fs.readFile(path.join(os.homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml"), "utf8");
const token = auth.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1];
if (!token) throw Error("Wrangler authentication unavailable");
const endpoint = "https://api.cloudflare.com/client/v4/accounts/425570893cf14d98277348565ec23eae/workers/scripts/whatsapp-webhook-meta-production";
async function get(suffix) {
  const response = await fetch(endpoint + suffix, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw Error(`Cloudflare inventory HTTP ${response.status}`);
  return response;
}
async function save(name, bytes) {
  const target = path.resolve(directory, name);
  if (!target.startsWith(directory + path.sep)) throw Error("Unsafe snapshot filename");
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const previous = await fs.readFile(target);
    if (!previous.equals(Buffer.from(bytes))) throw Error(`Existing snapshot drift: ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.writeFile(target, bytes, { flag: "wx" });
  }
}
function ssh(command) {
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "meowlab", command],
    { encoding: null, windowsHide: true, timeout: 30000, maxBuffer: 12 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`SSH inventory failed: ${result.error?.message ?? result.status}`);
  return result.stdout;
}
const deployments = (await (await get("/deployments")).json()).result;
const versions = deployments.deployments[0].versions;
if (versions.length !== 1 || versions[0].percentage !== 100) throw Error("Mixed Worker deployment requires separate review");
const settings = (await (await get("/settings")).json()).result;
const schedules = (await (await get("/schedules")).json()).result;
const content = await (await get("/content/v2")).formData();
const hashes = {};
for (const [name, file] of content) {
  if (typeof file === "string") continue;
  const relative = file.name || name;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await save(`worker/${relative}`, bytes);
  hashes[relative] = createHash("sha256").update(bytes).digest("hex");
}
for (const [name, data] of Object.entries({ deployments, settings, schedules })) {
  await save(`worker/${name}.json`, JSON.stringify(data, null, 2));
}
const inspection = JSON.parse(ssh("docker inspect manolo-platform-bridge-1").toString())[0];
const inventory = { image: inspection.Image, imageName: inspection.Config.Image,
  networks: Object.keys(inspection.NetworkSettings.Networks), mounts: inspection.Mounts.map(({ Type, Destination, Source, RW }) => ({ Type, Destination, Source, RW })),
  composeDirectory: inspection.Config.Labels["com.docker.compose.project.working_dir"],
  composeFiles: inspection.Config.Labels["com.docker.compose.project.config_files"],
  health: inspection.State.Health?.Status, command: inspection.Config.Cmd };
await save("bridge/inventory.json", JSON.stringify(inventory, null, 2));
const filenames = ssh("docker exec manolo-platform-bridge-1 find dist/node -maxdepth 1 -type f").toString().trim().split(/\r?\n/);
const bridgeHashes = {};
for (const filename of filenames) {
  if (!/^dist\/node\/[A-Za-z0-9._-]+\.mjs$/.test(filename)) throw Error("Unexpected bridge module filename");
  const bytes = ssh(`docker exec manolo-platform-bridge-1 cat ${filename}`);
  await save(`bridge/${path.basename(filename)}`, bytes);
  bridgeHashes[filename] = createHash("sha256").update(bytes).digest("hex");
}
console.log(JSON.stringify({ directory, version: versions[0].version_id, workerModules: hashes,
  bridgeImage: inventory.image, bridgeModules: bridgeHashes, health: inventory.health,
  cron: schedules.schedules.map((schedule) => schedule.cron), bindingNames: settings.bindings.map(({ name, type }) => ({ name, type })) }));
