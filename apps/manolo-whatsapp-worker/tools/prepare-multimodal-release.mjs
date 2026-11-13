// Local-only coherent transport/role release over the currently deployed bundle.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = path.join(root, "backups/multimodal-20261106/before");
const frozen = path.join(root, "backups/credit-summary-final-20261106/release/worker");
const output = path.join(root, "backups/multimodal-20261106/release");
const worker = path.join(output, "worker");
const expectedVersion = "85802e7f-99bb-4907-a4df-101fedb2388c";
const expectedImage = "sha256:84ee1c657f154b4e2f4aeda4c7797eff7db9d7036162c6964c6a429995d562f8";
const versions = JSON.parse(await fs.readFile(path.join(baseline, "worker/deployments.json"), "utf8")).deployments[0].versions;
const bridge = JSON.parse(await fs.readFile(path.join(baseline, "bridge/inventory.json"), "utf8"));
if (versions.length !== 1 || versions[0].version_id !== expectedVersion || versions[0].percentage !== 100
  || bridge.image !== expectedImage || bridge.health !== "healthy") throw Error("Baseline drift");
const write = async (name, bytes) => {
  const target = path.resolve(worker, name);
  if (!target.startsWith(worker + path.sep)) throw Error("Unsafe release path");
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
};
for (const dir of ["src", "test", "migrations"]) await fs.cp(path.join(frozen, dir), path.join(worker, dir), { recursive: true });
const source = await fs.readFile(path.join(root, "src/index.ts"), "utf8");
const start = source.indexOf("export async function processConversationTurn(");
const end = source.indexOf("\nasync function verificationResponse(", start);
if (start < 0 || end < 0 || !source.slice(start, end).trimEnd().endsWith("}")) throw Error("Runtime source anchors changed");
const turn = source.slice(start, end).replace(/^export /, "");
// Resolve all non-transport dependencies from the active runtime at call time.
// This preserves the actual RADAR/other-role instances rather than rebuilding them.
const dependencies = ["createWhatsAppClient", "createAudioTranscriber", "createAiProvider", "logSafeEvent", "DEFAULT_VISION_MODEL",
  "D1ConversationRepository", "resolveTenantContext", "transcribeWhatsAppAudio", "downloadIncomingDocument", "SignedVpsBridgeClient",
  "resolveEffectiveRole", "roleRegistry", "createContactRoleResolutionRequest", "ENTERPRISE_ADVISOR_ROLE_KEY", "PRINT_ADVISOR_ROLE_KEY",
  "PRINT_ADVISOR_PROVIDER", "QUOTE_ROLE_KEY", "createPlatformInboundSyncRequest", "createPlatformOutboundSyncRequest",
  "createPrintAdvisorBridgeRequest", "applyRadarAiConfig", "PrintSystemD1Repository", "D1QuoteNumberAllocator", "D1RoleStateRepository",
  "SignedStoreDesignClient", "SignedStoreCommerceClient", "VpsFacturayaClient", "R2DocumentStore", "D1RadarContactService",
  "RadarSelectionGateway", "RadarSyncBridgeClient", "generateAiReply", "FALLBACK_REPLY"];
const entry = `import { analyzeWhatsAppImage } from "./image/analysis";
import { withMultimodalContext } from "./ai/multimodal-context";
import { BURST_MAX_IMAGES, BURST_MAX_MESSAGES, isBurstContent } from "./conversations/burst-policy";
export { planBurst } from "./conversations/burst-policy";
export { EnterpriseAdvisorRoleHandler } from "./roles/enterprise-advisor-role";
export function createMultimodalTurn(dependencies) {
const { ${dependencies.join(", ")} } = dependencies;
${turn}
return processConversationTurn;
}
`;
await write("src/multimodal-entry.ts", entry);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = {};
const closure = await build({ absWorkingDir: root, stdin: { contents: entry, resolveDir: path.join(root, "src"), loader: "ts" },
  bundle: true, platform: "browser", format: "esm", target: "es2022", write: false, metafile: true });
for (const file of Object.keys(closure.metafile.inputs).filter((file) => file !== "<stdin>")) {
  const bytes = await fs.readFile(path.join(root, file)); await write(file, bytes); hashes[file] = sha(bytes);
}
for (const file of ["src/ai/contracts.ts", "src/roles/contracts.ts", "src/facturaya/contracts.ts"]) await write(file, await fs.readFile(path.join(root, file)));
const tests = ["enterprise-intent", "enterprise-navigation", "enterprise-advisor-role", "enterprise-despatch", "multimodal-burst",
  "whatsapp-burst", "image-analysis", "index"];
for (const name of tests) await write(`test/${name}.test.ts`, await fs.readFile(path.join(root, `test/${name}.test.ts`)));
await build({ entryPoints: [path.join(worker, "src/multimodal-entry.ts")], outfile: path.join(worker, "src/multimodal.js"),
  bundle: true, platform: "browser", format: "esm", target: "es2022" });
const original = await fs.readFile(path.join(baseline, "worker/index.js"), "utf8");
function declaration(name, prefix = "") {
  const match = original.match(new RegExp(`^${prefix}function ${name}\\([^]*?^__name\\w*\\(${name},`, "m"));
  if (!match) throw Error(`Missing declaration ${name}`);
  const text = match[0].slice(0, match[0].lastIndexOf("\n__name"));
  if (!text.trimEnd().endsWith("}")) throw Error(`Invalid declaration boundary ${name}`);
  return text;
}
for (const name of dependencies) if (!new RegExp(`\\b${name}\\b`).test(original)) throw Error(`Active dependency missing: ${name}`);
const replacements = [
  [declaration("processConversationTurn", "async "), `async function processConversationTurn(messages, env, expectedTenantId, blockCreation = false) {\nreturn createMultimodalTurn({ ${dependencies.join(", ")} })(messages, env, expectedTenantId, blockCreation);\n}`],
  [declaration("planBurst"), "function planBurst(entries, now) { return multimodalPlanBurst(entries, now); }"],
  ["new EnterpriseAdvisorRoleHandler()", "new MultimodalEnterpriseAdvisorRoleHandler()"],
];
let patched = original;
for (const [before, after] of replacements) {
  if (patched.split(before).length !== 2) throw Error("Nonunique patch anchor");
  patched = patched.replace(before, after);
}
let inverse = patched;
for (const [before, after] of [...replacements].reverse()) inverse = inverse.replace(after, before);
if (inverse !== original) throw Error("Unrelated runtime changed");
await write("src/index.js", 'import { createMultimodalTurn, planBurst as multimodalPlanBurst, EnterpriseAdvisorRoleHandler as MultimodalEnterpriseAdvisorRoleHandler } from "./multimodal.js";\n'
  + patched.replace(/^\/\/# sourceMappingURL=.*$/gm, ""));
const config = JSON.parse(await fs.readFile(path.join(frozen, "wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(baseline, "worker/settings.json"), "utf8"));
for (const binding of settings.bindings) if (binding.type === "plain_text" && binding.text !== config.vars[binding.name]) throw Error("Configuration drift");
const crons = JSON.parse(await fs.readFile(path.join(baseline, "worker/schedules.json"), "utf8")).schedules.map(s => s.cron);
if (JSON.stringify([...crons].sort()) !== JSON.stringify([...config.triggers.crons].sort())
  || config.compatibility_date !== settings.compatibility_date || JSON.stringify(config.compatibility_flags) !== JSON.stringify(settings.compatibility_flags)) throw Error("Compatibility/cron drift");
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
await write("package.json", '{"private":true,"type":"module"}\n');
const testConfig = (await fs.readFile(path.join(frozen, "vitest.config.js"), "utf8"))
  .replace('META_ACCESS_TOKEN: "test-meta-token", GROQ_API_KEY: "test-groq-key",',
    'META_ACCESS_TOKEN: "test-meta-access-token", GROQ_API_KEY: "test-groq-api-key", WHATSAPP_VERIFY_TOKEN: "test-verify-token", META_GRAPH_API_VERSION: "v-test", WHATSAPP_PHONE_NUMBER_ID: "123456789012345", ENVIRONMENT: "development",');
await write("vitest.config.js", testConfig);
await fs.writeFile(path.join(output, "release-manifest.json"), JSON.stringify({ baseVersion: expectedVersion, bridgeImagePreserved: expectedImage,
  originalSha256: sha(original), inverseVerified: true, replacementCount: replacements.length,
  extractedTurnSha256: sha(turn), sourceHashes: hashes, liveDependencies: dependencies, migrationRequired: [],
  scope: ["text/image batching", "per-original visual normalization", "prepare data independently of fiscal confirmation"],
  crons, secretsChanges: [], state: "prepared_not_published" }, null, 2) + "\n");
console.log(JSON.stringify({ output, baseVersion: expectedVersion, inverseVerified: true, anchors: replacements.length, sourceFiles: Object.keys(hashes).length }));
