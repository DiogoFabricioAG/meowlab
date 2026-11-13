// Compose onto a read-only snapshot of the deployed Worker, never the dirty monorepo entrypoint.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build, transform } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = path.join(root, "backups/radar-detail-20261104/after-worker");
const frozen = path.join(root, "backups/radar-detail-20261104/release");
const output = path.join(root, "backups/radar-presence-20261105/release");
const expectedVersion = "158b52bc-e20a-4a8f-ae31-92e64f3fdbef";
const metadata = JSON.parse(await fs.readFile(path.join(baseline, "deployments.json"), "utf8"));
const active = metadata.deployments[0].versions;
if (active.length !== 1 || active[0].version_id !== expectedVersion || active[0].percentage !== 100)
  throw Error("Unexpected baseline: take a fresh snapshot and review before preparing a release");
const original = await fs.readFile(path.join(baseline, "index.js"), "utf8");
const replacements = [
  ["await radarVerifiedWebhook(payload, env, void 0, (task) => ctx.waitUntil(task))", "await presenceReceipts(await radarVerifiedWebhook(payload, env, void 0, (task) => ctx.waitUntil(task)), env)"],
  ["  reminder_default as default,", "  presence_default as default,"],
  ["export {\n", "const presence_default = withRadarPresence(reminder_default);\nexport {\n"],
];
let patched = original.replace(/\r\n/g, "\n");
const normalized = patched;
for (const [before, after] of replacements) {
  if (patched.split(before).length !== 2) throw Error("Nonunique composition anchor");
  patched = patched.replace(before, after);
}
let recovered = patched;
for (const [before, after] of [...replacements].reverse()) recovered = recovered.replace(after, before);
if (recovered !== normalized) throw Error("Composition changed an unrelated handler");
patched = 'import { presenceReceipts, withRadarPresence } from "./radar/presence.js";\n'
  + patched.replace(/^\/\/# sourceMappingURL=.*$/gm, "");
const settings = JSON.parse(await fs.readFile(path.join(baseline, "settings.json"), "utf8"));
const schedules = JSON.parse(await fs.readFile(path.join(baseline, "schedules.json"), "utf8")).schedules;
const config = JSON.parse(await fs.readFile(path.join(frozen, "wrangler.jsonc"), "utf8"));
if (settings.compatibility_date !== config.compatibility_date
  || JSON.stringify(settings.compatibility_flags) !== JSON.stringify(config.compatibility_flags)) throw Error("Compatibility drift");
const configured = new Set([config.browser.binding, ...config.d1_databases.map(b => b.binding),
  ...config.r2_buckets.map(b => b.binding), ...config.durable_objects.bindings.map(b => b.name)]);
for (const binding of settings.bindings) {
  if (binding.type === "plain_text") {
    if (config.vars[binding.name] !== binding.text) throw Error("Deployed variables drifted");
  } else if (binding.type !== "secret_text" && !configured.has(binding.name)) throw Error("Unrecognized deployed binding");
  if (binding.type === "d1" && config.d1_databases.find(b => b.binding === binding.name)?.database_id !== binding.id)
    throw Error("D1 binding drift");
  if (binding.type === "r2_bucket" && config.r2_buckets.find(b => b.binding === binding.name)?.bucket_name !== binding.bucket_name)
    throw Error("R2 binding drift");
  if (binding.type === "durable_object_namespace" && config.durable_objects.bindings.find(b => b.name === binding.name)?.class_name !== binding.class_name)
    throw Error("Durable Object binding drift");
}
if (settings.bindings.filter(b => b.type === "plain_text").length !== Object.keys(config.vars).length)
  throw Error("Deployed variable inventory drifted");
config.triggers = { crons: [...new Set([...schedules.map(s => s.cron), "*/5 * * * *"])] };
const write = async (name, value) => {
  const destination = path.join(output, name); await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, value);
};
await fs.mkdir(output, { recursive: true });
// Only frozen sources are test support. Production routes come from the downloaded deployed bundle above.
for (const directory of ["src/radar", "src/adapters/radar", "src/roles", "src/bridge", "migrations", "test"])
  await fs.cp(path.join(frozen, directory), path.join(output, directory), { recursive: true });
await write("src/index.js", patched);
await build({ entryPoints: [path.join(root, "src/radar/presence.ts")], bundle: true,
  format: "esm", platform: "browser", target: "es2022", outfile: path.join(output, "src/radar/presence.js") });
// Tests import the helper path without an extension; remove only the obsolete test-support counterpart.
const oldHelper = path.join(output, "src/radar/presence.ts");
try { await fs.unlink(oldHelper); } catch (error) { if (error.code !== "ENOENT") throw error; }
await write("migrations/0019_radar_presence.sql", await fs.readFile(path.join(root, "migrations/0019_radar_presence.sql")));
await write("test/radar-presence.test.js", (await transform(await fs.readFile(path.join(root, "test/radar-presence.test.ts"), "utf8"), { loader: "ts" })).code);
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write("package.json", '{"private":true,"type":"module"}\n');
await fs.copyFile(path.join(frozen, "vitest.config.js"), path.join(output, "vitest.config.js"));
const sha = value => createHash("sha256").update(value).digest("hex");
await write("release-manifest.json", JSON.stringify({ baseVersion: expectedVersion, originalSha256: sha(original),
  reversibleCompositionPatch: true, changedCompositionAnchors: replacements.length,
  presenceModuleSha256: sha(await fs.readFile(path.join(output, "src/radar/presence.js"))),
  migrationRequired: ["0019_radar_presence.sql"], schedules: config.triggers.crons,
  secrets: settings.bindings.filter(b => b.type === "secret_text").map(b => b.name),
  state: "prepared_not_deployed", rollback: "Restore the previous Worker and its previous schedules; additive D1 presence tables may remain." }, null, 2) + "\n");
console.log(JSON.stringify({ output, baseVersion: expectedVersion, reversibleCompositionPatch: true, deployed: false }));
