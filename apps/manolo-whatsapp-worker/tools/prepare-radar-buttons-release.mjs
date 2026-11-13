// Isolated RADAR upgrade over the actual production Worker, not a dirty-tree deploy.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "backups/radar-buttons-20261031");
const snapshot = path.join(base, "actual-worker"), output = path.join(base, "release");
const version = "6034ee6c-ad53-4443-85a2-55f6a3b2179e";
const deployments = JSON.parse(await fs.readFile(path.join(snapshot, "deployments.json"), "utf8"));
if (deployments.deployments[0].versions.length !== 1 || deployments.deployments[0].versions[0].version_id !== version) throw Error("Unexpected deployment baseline");
const original = await fs.readFile(path.join(snapshot, "index.js"), "utf8");
let patched = original;
const replacements = [
  ["new RadarRoleHandler()", "new ConversationalRadarRoleHandler()"],
  ["new D1RadarContactService(env.DB, effectiveTenant.tenantId, activeMessage.phoneNumberId, activeMessage.to)",
    "new ConversationalRadarContactService(env.DB, effectiveTenant.tenantId, activeMessage.phoneNumberId, activeMessage.to)"],
  ["return radarHttp(request, env, () => Date.now(), new AiRadarAlertWriter(",
    "return conversationalRadarHttp(request, env, () => Date.now(), new ButtonAiRadarAlertWriter("],
  ['await persistOutbound(body, sendResult, "interactive");\n        if (sendResult.status !== "sent") {',
    'await persistOutbound(body, sendResult, "interactive");\n        if (sendResult.status !== "sent") {\n          if (effectiveTenant.roleKey === "radar") return sendResult;'],
];
for (const [before, after] of replacements) {
  if (patched.split(before).length !== 2) throw Error("Nonunique composition anchor");
  patched = patched.replace(before, after);
}
let recovered = patched;
for (const [before, after] of [...replacements].reverse()) recovered = recovered.replace(after, before);
if (recovered !== original) throw Error("Patch extends outside RADAR composition");
patched = `import { radarHttp as conversationalRadarHttp } from "./radar/http";
import { AiRadarAlertWriter as ButtonAiRadarAlertWriter } from "./adapters/radar/ai-alert-writer";
import { RadarRoleHandler as ConversationalRadarRoleHandler } from "./roles/radar-role";
import { D1RadarContactService as ConversationalRadarContactService } from "./adapters/radar/d1-contact-service";
` + patched.replace(/^\/\/# sourceMappingURL=.*$/gm, "");
const config = JSON.parse(await fs.readFile(path.join(root, "backups/radar-transport-20261031/release/wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(snapshot, "settings.json"), "utf8"));
for (const binding of settings.bindings) if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error("Production variables changed");
const write = async (name, text) => { const target = path.join(output, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); };
await write("src/index.js", patched);
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write("package.json", '{"private":true,"type":"module"}\n');
for (const relative of ["src/roles/radar-role.ts", "src/roles/radar-contracts.ts", "src/roles/radar-dialogue.ts",
  "src/adapters/radar/ai-alert-writer.ts", "src/adapters/radar/d1-contact-service.ts"])
  await write(relative, await fs.readFile(path.join(root, relative), "utf8"));
await fs.cp(path.join(root, "src/radar"), path.join(output, "src/radar"), { recursive: true });
await fs.cp(path.join(root, "migrations"), path.join(output, "migrations"), { recursive: true });
for (const name of ["apply-migrations", "radar.test", "radar-routing.test", "radar-conversation.test"])
  await write(`test/${name}.js`, (await transform(await fs.readFile(path.join(root, `test/${name}.ts`), "utf8"), { loader: "ts" })).code);
await fs.copyFile(path.join(root, "releases/bursts-20261022/vitest.config.js"), path.join(output, "vitest.config.js"));
const hash = value => createHash("sha256").update(value).digest("hex");
await write("release-manifest.json", JSON.stringify({ baseVersion: version, originalSha256: hash(original), patchedSha256: hash(patched),
  reversibleCompositionPatch: true, migrationRequired: [],
  changed: ["RADAR interactive alerts", "RADAR scoped button actions and pinned context", "RADAR ambiguous button fallback guard"],
  preserved: ["other role handlers", "burst runtime", "bindings and variables", "consent and 24h authority"] }, null, 2) + "\n");
console.log(JSON.stringify({ release: output, baseVersion: version, reversibleCompositionPatch: true, requiresMigration: [] }));
