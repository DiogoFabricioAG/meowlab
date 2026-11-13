// Build a scoped release over live snapshots. Local writes only; no deployment.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "backups/fiscal-20261105/before");
const output = path.join(root, "backups/fiscal-20261105/release");
const frozen = path.join(root, "backups/radar-detail-20261104/release");
const worker = path.join(output, "worker");
const bridge = path.join(output, "bridge");
const expectedVersion = "158b52bc-e20a-4a8f-ae31-92e64f3fdbef";
const expectedImage = "sha256:92f70092d8941b10463d9e38ff94067b58309eec03a931950a1fdf1fd220e5ab";
const deployments = JSON.parse(await fs.readFile(path.join(base, "worker/deployments.json"), "utf8"));
const active = deployments.deployments[0].versions;
const inventory = JSON.parse(await fs.readFile(path.join(base, "bridge/inventory.json"), "utf8"));
if (active.length !== 1 || active[0].version_id !== expectedVersion || active[0].percentage !== 100 || inventory.image !== expectedImage) throw Error("Baseline drift");
async function write(folder, name, bytes) {
  const target = path.resolve(folder, name);
  if (!target.startsWith(folder + path.sep)) throw Error("Unsafe release filename");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}
function patchExact(original, replacements) {
  let patched = original;
  for (const [before, after] of replacements) {
    if (patched.split(before).length !== 2) throw Error(`Nonunique anchor: ${before}`);
    patched = patched.replace(before, after);
  }
  let inverse = patched;
  for (const [before, after] of [...replacements].reverse()) inverse = inverse.replace(after, before);
  if (inverse !== original) throw Error("Patch changed unrelated bytes");
  return patched;
}
await fs.mkdir(output, { recursive: true });
// Reuse only the tested, already active RADAR sources/configuration for regression.
for (const name of ["src/radar", "src/adapters/radar", "src/roles", "src/bridge", "migrations", "test"]) {
  await fs.cp(path.join(frozen, name), path.join(worker, name), { recursive: true });
}
await write(worker, "src/fiscal-entry.ts", 'export { EnterpriseAdvisorRoleHandler } from "./roles/enterprise-advisor-role";\nexport { VpsFacturayaClient } from "./adapters/facturaya/vps-client";\n');
await write(bridge, "src/fiscal-entry.ts", 'export { FacturayaOperationService } from "./node/facturaya/operation-service";\nexport { isFacturayaBridgeRequest } from "./facturaya/bridge-contracts";\n');

// Discover the actual module closure, then freeze precisely those source files.
const entries = {
  worker: 'export { EnterpriseAdvisorRoleHandler } from "./src/roles/enterprise-advisor-role"; export { VpsFacturayaClient } from "./src/adapters/facturaya/vps-client";',
  bridge: 'export { FacturayaOperationService } from "./src/node/facturaya/operation-service"; export { isFacturayaBridgeRequest } from "./src/facturaya/bridge-contracts";',
};
const sourceHashes = {};
for (const [kind, contents] of Object.entries(entries)) {
  const result = await build({ absWorkingDir: root, stdin: { contents, resolveDir: root, loader: "ts" },
    bundle: true, platform: kind === "worker" ? "browser" : "node", format: "esm", target: "es2022",
    packages: "external", write: false, metafile: true });
  for (const file of Object.keys(result.metafile.inputs).filter((file) => file !== "<stdin>")) {
    const bytes = await fs.readFile(path.join(root, file));
    await write(kind === "worker" ? worker : bridge, file, bytes);
    sourceHashes[file] = createHash("sha256").update(bytes).digest("hex");
  }
}
const testNames = ["enterprise-advisor-role", "enterprise-despatch", "despatch-contracts", "despatch-client", "facturaya-client", "facturaya-multitenancy", "payment-terms", "whatsapp-burst"];
// Freeze the dependency closure of tests too, excluding installed packages.
for (const name of testNames) {
  const file = `test/${name}.test.ts`;
  const result = await build({ absWorkingDir: root, entryPoints: [file], bundle: true, platform: "node", format: "esm",
    packages: "external", external: ["cloudflare:workers", "cloudflare:test"], write: false, metafile: true });
  for (const input of Object.keys(result.metafile.inputs).filter((input) => input.startsWith("src/") || input.startsWith("test/"))) {
    // The test imports the real runtime: never replace its frozen patched entrypoint with dirty src/index.ts.
    if (input === "src/index.ts" || (input.startsWith("src/") && !sourceHashes[input] && !["src/conversations/burst-policy.ts", "src/node/security/credential-cipher.ts", "src/adapters/bridge/signed-vps-client.ts"].includes(input))) continue;
    await write(worker, input, await fs.readFile(path.join(root, input)));
  }
  await write(worker, file, await fs.readFile(path.join(root, file)));
}
for (const file of ["test/despatch-fixture.ts", "src/roles/contracts.ts", "src/facturaya/contracts.ts", "src/documents/contracts.ts", "src/ai/contracts.ts", "src/node/security/credential-cipher.ts", "src/adapters/bridge/signed-vps-client.ts", "src/bridge/contracts.ts", "src/bridge/signature.ts"]) {
  await write(worker, file, await fs.readFile(path.join(root, file)));
}
// Add bridge-only module closure for signed bridge contract tests.
for (const file of Object.keys(sourceHashes)) await write(worker, file, await fs.readFile(path.join(root, file)));
await build({ entryPoints: [path.join(worker, "src/fiscal-entry.ts")], outfile: path.join(worker, "src/fiscal.js"), bundle: true, platform: "browser", format: "esm", target: "es2022" });
await build({ entryPoints: [path.join(bridge, "src/fiscal-entry.ts")], outfile: path.join(bridge, "dist/node/fiscal-extension.mjs"), bundle: true, platform: "node", format: "esm", target: "node22", packages: "external" });
const workerOriginal = await fs.readFile(path.join(base, "worker/index.js"), "utf8");
const workerAnchors = [
  ["new EnterpriseAdvisorRoleHandler()", "new FiscalEnterpriseAdvisorRoleHandler()"],
  ["new VpsFacturayaClient(", "new FiscalVpsFacturayaClient("],
  ['blockCreation && activeMessage.interactionId?.startsWith("enterprise_issue_invoice")', 'blockCreation && (activeMessage.interactionId?.startsWith("enterprise_issue_invoice") || activeMessage.interactionId?.startsWith("enterprise_gre_confirm:"))'],
];
const patchedWorker = 'import { EnterpriseAdvisorRoleHandler as FiscalEnterpriseAdvisorRoleHandler, VpsFacturayaClient as FiscalVpsFacturayaClient } from "./fiscal.js";\n'
  + patchExact(workerOriginal, workerAnchors).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
await write(worker, "src/index.js", patchedWorker);
const bridgeOriginal = await fs.readFile(path.join(base, "bridge/server.mjs"), "utf8");
const bridgeAnchors = [
  ["new FacturayaOperationService(", "new FiscalFacturayaOperationService("],
  ["!isFacturayaBridgeRequest(payload)", "!isFiscalFacturayaBridgeRequest(payload)"],
];
await write(bridge, "dist/node/server.mjs", 'import { FacturayaOperationService as FiscalFacturayaOperationService, isFacturayaBridgeRequest as isFiscalFacturayaBridgeRequest } from "./fiscal-extension.mjs";\n'
  + patchExact(bridgeOriginal, bridgeAnchors));
await write(bridge, "Dockerfile", 'FROM manolo-platform-bridge:before-fiscal-20261105\nCOPY --chown=node:node dist/node/server.mjs /app/dist/node/server.mjs\nCOPY --chown=node:node dist/node/fiscal-extension.mjs /app/dist/node/fiscal-extension.mjs\nUSER node\nCMD ["node", "dist/node/server.mjs"]\n');
const config = JSON.parse(await fs.readFile(path.join(frozen, "wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(base, "worker/settings.json"), "utf8"));
const schedules = JSON.parse(await fs.readFile(path.join(base, "worker/schedules.json"), "utf8")).schedules.map((item) => item.cron);
for (const binding of settings.bindings) if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error(`Variable drift: ${binding.name}`);
if (config.compatibility_date !== settings.compatibility_date || JSON.stringify(config.compatibility_flags) !== JSON.stringify(settings.compatibility_flags)
  || JSON.stringify([...config.triggers.crons].sort()) !== JSON.stringify(schedules.sort())) throw Error("Compatibility or cron drift");
await write(worker, "wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write(worker, "package.json", '{"private":true,"type":"module"}\n');
await write(worker, "test/fixed-clock.js", 'import { beforeEach, vi } from "vitest";\nbeforeEach(({ task }) => { if (/radar.*\\.test\\.js$/.test(task.file?.filepath ?? "")) vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-05T15:00:00Z")); });\n');
let testConfig = await fs.readFile(path.join(frozen, "vitest.config.js"), "utf8");
testConfig = testConfig.replace('include: ["test/**/*.test.js"]', 'include: ["test/**/*.test.js", "test/**/*.test.ts"]')
  .replace('setupFiles: ["./test/apply-migrations.js"]', 'setupFiles: ["./test/apply-migrations.js", "./test/fixed-clock.js"]');
await write(worker, "vitest.config.js", testConfig);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = { baseWorkerVersion: expectedVersion, baseBridgeImage: expectedImage,
  originalWorkerSha256: hash(workerOriginal), originalBridgeSha256: hash(bridgeOriginal),
  workerAnchors, bridgeAnchors, reversible: true, cron: schedules, sourceHashes,
  files: { worker: hash(patchedWorker), fiscalWorkerModule: hash(await fs.readFile(path.join(worker, "src/fiscal.js"))),
    bridge: hash(await fs.readFile(path.join(bridge, "dist/node/server.mjs"))), fiscalBridgeModule: hash(await fs.readFile(path.join(bridge, "dist/node/fiscal-extension.mjs"))) },
  databaseMigrations: [], secretsChanges: [], state: "prepared_not_published", testClockOnly: "2026-11-05T15:00:00Z",
  scope: ["credit payment terms", "GRE remitente private sale", "explicit M1/L/other first", "uncertain burst blocks both fiscal confirmation buttons"],
  excluded: ["RADAR presence changes", "other roles", "runtime entrypoint rebuild", "GRE credentials/correlative", "real issuance"] };
await write(output, "release-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, baseWorkerVersion: expectedVersion, baseBridgeImage: expectedImage,
  reversibleWorkerAnchors: workerAnchors.length, reversibleBridgeAnchors: bridgeAnchors.length, published: false }));
