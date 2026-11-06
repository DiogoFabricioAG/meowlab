// Local-only release preparation over a verified live Worker snapshot.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "backups/money-state-20261106/before");
const frozen = path.join(root, "backups/gre-fixes-20261106/release/worker");
const output = path.join(root, "backups/money-state-20261106/release");
const worker = path.join(output, "worker");
const expectedVersion = "173dde02-c427-4738-a0c5-521459cf3b4f";
const expectedImage = "sha256:29c6582f7e7ed6592209dced3d535721b663f3384c962b0565bbc1caa4d75248";
const versions = JSON.parse(await fs.readFile(path.join(base, "worker/deployments.json"), "utf8")).deployments[0].versions;
const inventory = JSON.parse(await fs.readFile(path.join(base, "bridge/inventory.json"), "utf8"));
if (versions.length !== 1 || versions[0].version_id !== expectedVersion || versions[0].percentage !== 100
  || inventory.image !== expectedImage || inventory.health !== "healthy") throw Error("Unexpected production baseline");
async function write(name, bytes) {
  const target = path.resolve(worker, name);
  if (!target.startsWith(worker + path.sep)) throw Error("Unsafe release filename");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}
for (const dir of ["src", "test", "migrations"]) await fs.cp(path.join(frozen, dir), path.join(worker, dir), { recursive: true });
const sourceHashes = {};
const sha = (data) => createHash("sha256").update(data).digest("hex");
const contents = 'export { EnterpriseAdvisorRoleHandler } from "./src/roles/enterprise-advisor-role"; export { OpenAiCompatibleAdapter } from "./src/adapters/ai/openai-compatible-adapter";';
const closure = await build({ absWorkingDir: root, stdin: { contents, resolveDir: root, loader: "ts" },
  bundle: true, platform: "browser", format: "esm", target: "es2022", packages: "external", write: false, metafile: true });
for (const file of Object.keys(closure.metafile.inputs).filter((file) => file !== "<stdin>")) {
  const bytes = await fs.readFile(path.join(root, file));
  await write(file, bytes); sourceHashes[file] = sha(bytes);
}
await write("src/intent-entry.ts", contents.replaceAll('"./src/', '"./') + "\n");
const tests = ["enterprise-intent", "enterprise-navigation", "enterprise-advisor-role", "enterprise-despatch",
  "openai-compatible-adapter", "whatsapp-burst", "decisions", "facturaya-client", "facturaya-multitenancy", "payment-terms",
  "despatch-client", "despatch-contracts"];
// Keep existing frozen runtime imports and other roles for integration regression.
for (const name of tests) {
  const file = `test/${name}.test.ts`;
  const result = await build({ absWorkingDir: root, entryPoints: [file], bundle: true, platform: "node", format: "esm",
    packages: "external", external: ["cloudflare:workers", "cloudflare:test"], write: false, metafile: true });
  for (const input of Object.keys(result.metafile.inputs).filter((input) => input.startsWith("src/") || input.startsWith("test/"))) {
    if (input === "src/index.ts") continue;
    if (input.startsWith("src/") && !sourceHashes[input]
      && !["src/ai/contracts.ts", "src/ai/decisions.ts", "src/roles/contracts.ts", "src/facturaya/contracts.ts",
        "src/node/security/credential-cipher.ts", "src/adapters/bridge/signed-vps-client.ts", "src/bridge/contracts.ts",
        "src/bridge/signature.ts", "src/conversations/burst-policy.ts"].includes(input)) continue;
    await write(input, await fs.readFile(path.join(root, input)));
  }
  await write(file, await fs.readFile(path.join(root, file)));
}
await build({ entryPoints: [path.join(worker, "src/intent-entry.ts")], outfile: path.join(worker, "src/money-state.js"),
  bundle: true, platform: "browser", format: "esm", target: "es2022" });
const original = await fs.readFile(path.join(base, "worker/index.js"), "utf8");
const replacements = [["new EnterpriseAdvisorRoleHandler()", "new MoneyStateEnterpriseAdvisorRoleHandler()"]];
let patched = original;
for (const [before, after] of replacements) {
  if (patched.split(before).length !== 2) throw Error(`Nonunique runtime anchor: ${before}`);
  patched = patched.replace(before, after);
}
let inverse = patched;
for (const [before, after] of [...replacements].reverse()) inverse = inverse.replace(after, before);
if (inverse !== original) throw Error("Unrelated runtime bytes changed");
await write("src/index.js", 'import { EnterpriseAdvisorRoleHandler as MoneyStateEnterpriseAdvisorRoleHandler } from "./money-state.js";\n'
  + patched.replace(/^\/\/# sourceMappingURL=.*$/gm, ""));
const config = JSON.parse(await fs.readFile(path.join(frozen, "wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(base, "worker/settings.json"), "utf8"));
const crons = JSON.parse(await fs.readFile(path.join(base, "worker/schedules.json"), "utf8")).schedules.map((s) => s.cron);
for (const binding of settings.bindings) if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error(`Variable drift: ${binding.name}`);
if (config.compatibility_date !== settings.compatibility_date || JSON.stringify(config.compatibility_flags) !== JSON.stringify(settings.compatibility_flags)
  || JSON.stringify([...config.triggers.crons].sort()) !== JSON.stringify([...crons].sort())) throw Error("Compatibility/cron drift");
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write("package.json", '{"private":true,"type":"module"}\n');
await write("vitest.config.js", await fs.readFile(path.join(frozen, "vitest.config.js")));
await write("test/fixed-clock.js", await fs.readFile(path.join(frozen, "test/fixed-clock.js")));
const manifest = { baseWorkerVersion: expectedVersion, bridgeImagePreserved: expectedImage,
  originalSha256: sha(original), reversibleAnchors: replacements, inverseVerified: true, sourceHashes, crons,
  runtimeSha256: sha(await fs.readFile(path.join(worker, "src/index.js"))),
  intentModuleSha256: sha(await fs.readFile(path.join(worker, "src/money-state.js"))),
  migrations: [], secretsChanges: [], bridgeChanges: [], realFiscalOperations: false,
  scope: ["normalize user money evidence", "persist per-field payment outcomes", "render only persisted billing data"], state: "prepared_not_published" };
await fs.writeFile(path.join(output, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, expectedVersion, reversibleAnchors: replacements.length, sourceFiles: Object.keys(sourceHashes).length, published: false }));
