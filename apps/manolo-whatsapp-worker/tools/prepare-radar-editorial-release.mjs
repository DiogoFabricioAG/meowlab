// Change only RADAR composition on the actual runtime; preserve reminders and all other roles.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build, transform } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = path.join(root, "backups/radar-window-reminder-20261104/after-worker");
const frozen = path.join(root, "backups/radar-window-reminder-20261104/release");
const output = path.join(root, "backups/radar-editorial-20261104/release");
const expectedVersion = "d1ab0df4-5a89-4b1b-8032-4ab4f92cd6f8";
const deployed = JSON.parse(await fs.readFile(path.join(baseline, "deployments.json"), "utf8")).deployments[0].versions;
if (deployed.length !== 1 || deployed[0].version_id !== expectedVersion || deployed[0].percentage !== 100) throw Error("Unexpected runtime baseline");
const original = await fs.readFile(path.join(baseline, "index.js"), "utf8");
const normalized = original.replace(/\r\n/g, "\n");
const replacements = [
  ["return radarHttp(request, env, () => Date.now(), new AiRadarAlertWriter(", "return editorialRadarHttp(request, env, () => Date.now(), new EditorialAiRadarAlertWriter("],
  ["new RadarRoleHandler()", "new EditorialRadarRoleHandler()"],
];
let patched = normalized;
for (const [before, after] of replacements) {
  if (patched.split(before).length !== 2) throw Error("Nonunique composition anchor");
  patched = patched.replace(before, after);
}
let recovered = patched;
for (const [before, after] of [...replacements].reverse()) recovered = recovered.replace(after, before);
if (recovered !== normalized) throw Error("Unrelated runtime modified");
patched = 'import { radarHttp as editorialRadarHttp, AiRadarAlertWriter as EditorialAiRadarAlertWriter, RadarRoleHandler as EditorialRadarRoleHandler } from "./editorial.js";\n'
  + patched.replace(/^\/\/# sourceMappingURL=.*$/gm, "");
const write = async (name, value) => { const target = path.join(output, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, value); };
await fs.mkdir(output, { recursive: true });
for (const directory of ["src/radar", "src/adapters/radar", "src/roles", "src/bridge", "migrations"])
  await fs.cp(path.join(frozen, directory), path.join(output, directory), { recursive: true });
// Overlay only reviewed files; never compile the dirty monorepo entrypoint.
for (const name of ["src/radar/http.ts", "src/radar/presentation.ts", "src/adapters/radar/ai-alert-writer.ts", "src/roles/radar-dialogue.ts"])
  await write(name, await fs.readFile(path.join(root, name)));
await write("src/editorial-entry.ts", 'export { radarHttp } from "./radar/http";\nexport { AiRadarAlertWriter } from "./adapters/radar/ai-alert-writer";\nexport { RadarRoleHandler } from "./roles/radar-role";\n');
await build({ entryPoints: [path.join(output, "src/editorial-entry.ts")], outfile: path.join(output, "src/editorial.js"),
  bundle: true, platform: "browser", format: "esm", target: "es2022" });
await write("src/index.js", patched);
const config = JSON.parse(await fs.readFile(path.join(frozen, "wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(baseline, "settings.json"), "utf8"));
for (const binding of settings.bindings) if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error("Variable drift");
const schedules = JSON.parse(await fs.readFile(path.join(baseline, "schedules.json"), "utf8")).schedules.map(s => s.cron);
if (JSON.stringify(schedules.sort()) !== JSON.stringify([...config.triggers.crons].sort())) throw Error("Reminder cron drift");
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write("package.json", '{"private":true,"type":"module"}\n');
await fs.copyFile(path.join(frozen, "vitest.config.js"), path.join(output, "vitest.config.js"));
for (const name of ["apply-migrations", "radar.test", "radar-routing.test", "radar-conversation.test", "radar-interest.test", "radar-sync-http.test", "radar-summary.test", "radar-window-reminder.test", "radar-editorial.test", "radar-editorial-fixture"])
  await write(`test/${name}.js`, (await transform(await fs.readFile(path.join(root, `test/${name}.ts`), "utf8"), { loader: "ts" })).code);
const sha = value => createHash("sha256").update(value).digest("hex");
await write("release-manifest.json", JSON.stringify({ baseVersion: expectedVersion, originalSha256: sha(original),
  editorialModuleSha256: sha(await fs.readFile(path.join(output, "src/editorial.js"))),
  reversibleCompositionPatch: true, changedCompositionAnchors: replacements.length, migrationRequired: [],
  state: "prepared_not_deployed", schedules: config.triggers.crons,
  changed: ["AI editorial object and purpose with public evidence quotes", "no raw-title fallback: retain pending on AI failure", "do not reuse legacy rejected-title cache", "readable summary follow-up fallback"] }, null, 2) + "\n");
console.log(JSON.stringify({ output, baseVersion: expectedVersion, reversibleCompositionPatch: true, deployed: false }));
