// Two-literal production patch; no application rebuild from the dirty working tree.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "backups/radar-transport-20261031");
const snapshot = path.join(base, "actual-worker");
const output = path.join(base, "release");
const version = "b406aab4-86cc-4dfd-a8cd-4d0a5edb9fe6";
const deployments = JSON.parse(await fs.readFile(path.join(snapshot, "deployments.json"), "utf8"));
if (deployments.deployments[0].versions.length !== 1 || deployments.deployments[0].versions[0].version_id !== version) throw Error("Production baseline changed");
const original = await fs.readFile(path.join(snapshot, "index.js"), "utf8");
if (original.split('redirect: "error"').length !== 3) throw Error("Unexpected redirect occurrences");
for (const [start, end] of [["async function sendAlert(", "async function radarHttp("], ["async function acknowledge(", "async function radarVerifiedWebhook("]]) {
  const block = original.slice(original.indexOf(start), original.indexOf(end));
  if (block.split('redirect: "error"').length !== 2) throw Error("Redirect outside reviewed RADAR transport");
}
const patched = original.replaceAll('redirect: "error"', 'redirect: "manual"');
if (patched.replaceAll('redirect: "manual"', 'redirect: "error"') !== original) throw Error("Patch is not limited to two mode literals");
const config = JSON.parse(await fs.readFile(path.join(root, "backups/radar-role-20261031/release/wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(snapshot, "settings.json"), "utf8"));
for (const binding of settings.bindings) if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error("Production variables changed");
const write = async (name, content) => { const target = path.join(output, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); };
await write("src/index.js", patched.replace(/^\/\/# sourceMappingURL=.*$/gm, ""));
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write("package.json", '{"private":true,"type":"module"}\n');
await fs.cp(path.join(root, "src/radar"), path.join(output, "src/radar"), { recursive: true });
await fs.cp(path.join(root, "migrations"), path.join(output, "migrations"), { recursive: true });
for (const [source, target] of [["apply-migrations", "apply-migrations"], ["radar.test", "radar.test"], ["radar-routing.test", "radar-routing.test"]])
  await write(`test/${target}.js`, (await transform(await fs.readFile(path.join(root, `test/${source}.ts`), "utf8"), { loader: "ts" })).code);
await fs.copyFile(path.join(root, "releases/bursts-20261022/vitest.config.js"), path.join(output, "vitest.config.js"));
const hash = text => createHash("sha256").update(text).digest("hex");
await write("release-manifest.json", JSON.stringify({ baseVersion: version, originalSha256: hash(original), patchedSha256: hash(patched),
  changed: ["sendAlert redirect mode", "link acknowledgement redirect mode", "remove obsolete sourcemap reference"], preservedOtherRuntime: true }, null, 2) + "\n");
console.log(JSON.stringify({ release: output, baseVersion: version, changedTransportLiterals: 2, preservedOtherRuntime: true }));
