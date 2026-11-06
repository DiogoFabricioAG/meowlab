// Build an isolated, reproducible release over the reviewed production snapshot.
// Generated JS is versioned deliberately: unrelated local Manolo changes never
// enter this production package. No credentials or customer data are copied.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = path.join(root, "backups/radar-activation-20261018/radar-release");
const output = path.join(root, "releases/bursts-20261022");
const hash = value => createHash("sha256").update(value).digest("hex");
const actual = path.join(root, "backups/burst-activation-20261022/actual-worker");
const base = await fs.readFile(path.join(actual, "index.js"), "utf8");
const deployments = JSON.parse(await fs.readFile(path.join(actual, "deployments.json"), "utf8"));
if (deployments.deployments[0].versions.length !== 1
  || deployments.deployments[0].versions[0].version_id !== "02e3ea4b-da57-47ba-b73d-4ecb4fe8f849") throw Error("Production baseline changed");
const source = await fs.readFile(path.join(root, "src/index.ts"), "utf8");
const replace = (text, before, after) => {
  if (text.split(before).length !== 2) throw Error(`Nonunique release anchor: ${before.slice(0, 70)}`);
  return text.replace(before, after);
};
const begin = source.indexOf("export async function processConversationTurn(");
const end = source.indexOf("\nasync function verificationResponse(", begin);
if (begin < 0 || end < 0) throw Error("Runtime extraction anchor missing");
const runtime = (await transform(source.slice(begin, end), { loader: "ts", target: "es2022" })).code;
const start = base.indexOf("async function processIncomingMessages(payload, env) {");
const finishAnchor = '__name(processIncomingMessages, "processIncomingMessages");';
const finish = base.indexOf(finishAnchor, start) + finishAnchor.length;
if (start < 0 || finish < finishAnchor.length) throw Error("Production runtime anchor missing");
const wrapper = `async function processIncomingMessages(payload, env) {
  await Promise.all(extractIncomingMessages(payload, env).map(message => processConversationTurn([message], env)));
}\n`;
let patched = base.slice(0, start) + wrapper + runtime + base.slice(finish);
const previousAdmission = "  ctx.waitUntil(processIncomingMessages(routedPayload, env));";
const admissionBegin = source.indexOf('  if (String(env.WHATSAPP_BURST_ENABLED) === "true")');
const admissionEnd = source.indexOf('\n\n  return jsonResponse({ received: true });', admissionBegin);
patched = replace(patched, previousAdmission, source.slice(admissionBegin, admissionEnd));
patched = replace(patched, "content: messageText.slice(0, MAX_INCOMING_MESSAGE_LENGTH2)", "content: messageText.slice(0, BURST_MAX_CHARS)");
const dispatch = "  async fetch(request, env, ctx) {\n    const url = new URL(request.url);";
patched = replace(patched, dispatch, dispatch + `
    if (url.pathname === BURST_ADMIN_PATH) {
      try { return await burstAdminHttp(request, env); }
      catch { return jsonResponse({ error: "review_unavailable" }, 503); }
    }`);
patched = `import { burstKey, BURST_MAX_CHARS } from "./conversations/burst-policy.js";
import { BURST_ADMIN_PATH, burstAdminHttp } from "./conversations/burst-admin.js";
export { WhatsAppBurst } from "./conversations/whatsapp-burst.js";
` + patched.replace(/\n\/\/# sourceMappingURL=index\.js\.map\s*$/, "\n");
const write = async (relative, text) => {
  const destination = path.join(output, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, text);
};
await write("src/index.js", patched);
const modules = {};
for (const name of ["burst-policy", "whatsapp-burst", "burst-admin"]) {
  const text = await fs.readFile(path.join(root, `src/conversations/${name}.ts`), "utf8");
  await write(`src/conversations/${name}.js`, (await transform(text, { loader: "ts", target: "es2022" })).code);
  modules[name] = hash(text);
}
// Freeze the same RADAR modules as the current deployed package.
await fs.cp(path.join(baseline, "src/radar"), path.join(output, "src/radar"), { recursive: true });
for (const name of ["whatsapp-burst", "burst-admin", "radar"]) {
  const test = await fs.readFile(path.join(root, `test/${name}.test.ts`), "utf8");
  await write(`test/${name}.test.js`, (await transform(test, { loader: "ts", target: "es2022" })).code);
}
const setup = await fs.readFile(path.join(root, "test/apply-migrations.ts"), "utf8");
await write("test/apply-migrations.js", (await transform(setup, { loader: "ts", target: "es2022" })).code);
await fs.cp(path.join(root, "migrations"), path.join(output, "migrations"), { recursive: true });
const config = JSON.parse(await fs.readFile(path.join(baseline, "wrangler.jsonc"), "utf8"));
const settings = JSON.parse(await fs.readFile(path.join(actual, "settings.json"), "utf8"));
for (const binding of settings.bindings) {
  if (binding.type === "plain_text" && config.vars[binding.name] !== binding.text) throw Error(`Production variable changed: ${binding.name}`);
  if (!["plain_text", "secret_text", "d1", "r2_bucket", "browser"].includes(binding.type)) throw Error(`Unreviewed binding: ${binding.name}`);
}
config.durable_objects = { bindings: [{ name: "WHATSAPP_BURSTS", class_name: "WhatsAppBurst" }] };
config.migrations = [{ tag: "whatsapp-bursts-v1", new_sqlite_classes: ["WhatsAppBurst"] }];
config.vars.WHATSAPP_BURST_ENABLED = "true";
await write("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
pkg.scripts = { test: "vitest run", "deploy:dry": "wrangler deploy --dry-run --keep-vars", deploy: "wrangler deploy --keep-vars" };
await write("package.json", JSON.stringify(pkg, null, 2) + "\n");
await fs.copyFile(path.join(root, "package-lock.json"), path.join(output, "package-lock.json"));
await write("vitest.config.js", `import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
export default defineConfig({ plugins: [cloudflareTest(async () => ({
  wrangler: { configPath: "./wrangler.jsonc" }, miniflare: {
    bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations"),
      META_APP_SECRET: "test-meta-secret", META_ACCESS_TOKEN: "test-meta-token", GROQ_API_KEY: "test-groq-key",
      VPS_BRIDGE_HMAC_SECRET: "test-hmac-key-at-least-32-characters", VPS_BRIDGE_ENABLED: "false",
      VPS_PLATFORM_SHADOW_ENABLED: "false", WHATSAPP_BURST_ENABLED: "false" }
  } }))], test: { include: ["test/**/*.test.js"], setupFiles: ["./test/apply-migrations.js"] } });\n`);
await write("release-manifest.json", JSON.stringify({ baseVersion: "02e3ea4b-da57-47ba-b73d-4ecb4fe8f849",
  baseSourceSha256: hash(base), sourceSha256: hash(patched), modules,
  scope: ["ingress admission", "conversation batch runtime", "bounded prompt", "HMAC admin recovery", "DO binding and flag"],
  preserved: ["RADAR modules", "all other deployed business handlers", "provider/model configuration", "VPS configuration"] }, null, 2) + "\n");
console.log(JSON.stringify({ release: "releases/bursts-20261022", baseVersion: "02e3ea4b-da57-47ba-b73d-4ecb4fe8f849", sourceSha256: hash(patched) }));
