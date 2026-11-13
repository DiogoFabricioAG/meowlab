// Narrow production patch: never publish unrelated local changes to Manolo.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = path.join(root, "backups/radar-role-20261031/actual-worker");
const output = path.join(root, "backups/radar-role-20261031/release");
const baseline = "bf74500a-59ea-4820-be93-aa3c89adb780";
const deployments = JSON.parse(await fs.readFile(path.join(snapshot, "deployments.json"), "utf8"));
if (deployments.deployments[0].versions.length !== 1 || deployments.deployments[0].versions[0].version_id !== baseline) throw Error("Unexpected deployment baseline");
const settings = JSON.parse(await fs.readFile(path.join(snapshot, "settings.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(root, "releases/bursts-20261022/wrangler.jsonc"), "utf8"));
for (const binding of settings.bindings) {
  if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error(`Changed production variable ${binding.name}`);
  if (!["plain_text", "secret_text", "d1", "r2_bucket", "browser", "durable_object_namespace"].includes(binding.type)) throw Error(`Unreviewed binding ${binding.name}`);
}
if (config.compatibility_date !== settings.compatibility_date) throw Error("Compatibility date changed");
let patched = await fs.readFile(path.join(snapshot, "index.js"), "utf8");
const original = patched;
const replacements = [];
function replace(before, after) {
  if (patched.split(before).length !== 2) throw Error(`Nonunique patch anchor ${before.slice(0, 70)}`);
  patched = patched.replace(before, after); replacements.push([before, after]);
}
const webhook = await fs.readFile(path.join(root, "src/radar/webhook.ts"), "utf8");
const compiled = (await transform(webhook.slice(webhook.indexOf("export async function radarVerifiedWebhook")).replace("export async function", "async function"), { loader: "ts", target: "es2022" })).code;
const begin = patched.indexOf("async function radarVerifiedWebhook(");
const endMarker = '__name2(radarVerifiedWebhook, "radarVerifiedWebhook");';
const end = patched.indexOf(endMarker, begin) + endMarker.length;
if (begin < 0 || end < endMarker.length) throw Error("Missing webhook patch boundary");
replace(patched.slice(begin, end), compiled.trimEnd());
replace("    new EnterpriseAdvisorRoleHandler()\n", "    new EnterpriseAdvisorRoleHandler(),\n    new RadarRoleHandler()\n");
replace("      roleState,\n      storeDesigner,", "      roleState,\n      radar: new D1RadarContactService(env.DB, effectiveTenant.tenantId, activeMessage.phoneNumberId, activeMessage.to),\n      storeDesigner,");
let recovered = patched;
for (const [before, after] of [...replacements].reverse()) recovered = recovered.replace(after, before);
if (recovered !== original) throw Error("Patch modified unrelated production source");
patched = 'import { RadarRoleHandler } from "./roles/radar-role";\nimport { D1RadarContactService } from "./adapters/radar/d1-contact-service";\n' + patched;
const write = async (relative, text) => { const target = path.join(output, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); };
await write("src/index.js", patched);
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
for (const relative of ["src/roles/radar-role.ts", "src/roles/radar-contracts.ts", "src/adapters/radar/d1-contact-service.ts"])
  await write(relative, await fs.readFile(path.join(root, relative), "utf8"));
await fs.cp(path.join(root, "src/radar"), path.join(output, "src/radar"), { recursive: true });
await fs.cp(path.join(root, "migrations"), path.join(output, "migrations"), { recursive: true });
await write("test/apply-migrations.js", (await transform(await fs.readFile(path.join(root, "test/apply-migrations.ts"), "utf8"), { loader: "ts" })).code);
for (const name of ["radar", "radar-routing"])
  await write(`test/${name}.test.js`, (await transform(await fs.readFile(path.join(root, `test/${name}.test.ts`), "utf8"), { loader: "ts" })).code);
await fs.copyFile(path.join(root, "releases/bursts-20261022/vitest.config.js"), path.join(output, "vitest.config.js"));
await write("package.json", '{"private":true,"type":"module"}\n');
const hash = text => createHash("sha256").update(text).digest("hex");
await write("release-manifest.json", JSON.stringify({ baseVersion: baseline, originalSha256: hash(original), patchedSha256: hash(patched),
  reversibleProductionPatch: true, scope: ["RADAR role registration", "bound status adapter", "RADAR control parsing and response"],
  preserved: ["other role handlers", "burst runtime", "bindings", "provider/model configuration", "existing contact assignments"] }, null, 2) + "\n");
console.log(JSON.stringify({ release: output, baseVersion: baseline, reversibleProductionPatch: true }));
