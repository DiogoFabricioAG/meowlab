// Upgrade only the RADAR HTTP composition over the actual active selection build.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = path.join(root, "backups/radar-selection-20261101/after-worker");
const output = path.join(root, "backups/radar-selection-20261101/compat-release");
const version = "aed8e907-cfc4-45a6-ae4b-4b751ca2ed72";
const deployments = JSON.parse(await fs.readFile(path.join(baseline, "deployments.json"), "utf8"));
if (deployments.deployments[0].versions.length !== 1 || deployments.deployments[0].versions[0].version_id !== version) throw Error("Unexpected baseline");
const original = await fs.readFile(path.join(baseline, "index.js"), "utf8");
const anchor = "return radarHttp(request, env, () => Date.now(), new AiRadarAlertWriter(";
if (original.split(anchor).length !== 2) throw Error("Nonunique HTTP anchor");
const replacement = "return compatibleRadarHttp(request, env, () => Date.now(), new AiRadarAlertWriter(";
const importLine = 'import { radarHttp as compatibleRadarHttp } from "./radar/http";\n';
const patched = importLine + original.replace(anchor, replacement).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
if (patched.slice(importLine.length).replace(replacement, anchor) !== original.replace(/^\/\/# sourceMappingURL=.*$/gm, "")) throw Error("Patch changed other runtime");
const write = async (name, content) => { const target = path.join(output, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); };
const config = JSON.parse(await fs.readFile(path.join(root, "backups/radar-selection-20261101/release/wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(baseline, "settings.json"), "utf8"));
for (const binding of settings.bindings) if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error("Variables changed");
await write("src/index.js", patched);
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write("package.json", '{"private":true,"type":"module"}\n');
for (const directory of ["src/radar", "src/adapters/radar", "migrations"]) await fs.cp(path.join(root, directory), path.join(output, directory), { recursive: true });
for (const file of ["src/roles/radar-role.ts", "src/roles/radar-contracts.ts", "src/roles/radar-dialogue.ts", "src/bridge/signature.ts"])
  await write(file, await fs.readFile(path.join(root, file), "utf8"));
for (const name of ["apply-migrations", "radar.test", "radar-routing.test", "radar-conversation.test", "radar-interest.test", "radar-sync-http.test"])
  await write(`test/${name}.js`, (await transform(await fs.readFile(path.join(root, `test/${name}.ts`), "utf8"), { loader: "ts" })).code);
await fs.copyFile(path.join(root, "releases/bursts-20261022/vitest.config.js"), path.join(output, "vitest.config.js"));
await write("release-manifest.json", JSON.stringify({ baseVersion: version, originalSha256: createHash("sha256").update(original).digest("hex"), reversibleCompositionPatch: true,
  changed: ["publish public candidate before Meta for older desktop clients"], migrationRequired: [] }, null, 2) + "\n");
console.log(JSON.stringify({ release: output, baseline: version, changedCompositionAnchors: 1 }));
