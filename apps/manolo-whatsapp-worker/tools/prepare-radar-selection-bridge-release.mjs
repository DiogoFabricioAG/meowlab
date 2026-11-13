// Prepare a reviewable bundle-only bridge patch from the live image snapshot.
// This tool performs read-only SSH and local artifact writes only; it never deploys.
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backupRoot = path.join(appRoot, "backups/radar-selection-20261101");
const actualDir = path.join(backupRoot, "actual-bridge");
const releaseDir = path.join(backupRoot, "bridge-release");
const serverRelativePath = "dist/node/server.mjs";
const baseImage = "manolo-platform-bridge:radar-before-20261101";
const sourceAnchor = "const handler = createBridgeHttpHandler({";
const patchedAnchor = "const handler = createRadarBridgeExtension(createBridgeHttpHandler, new PgRadarSelectionService(connection.pool), {";
const imports = 'import { createRadarBridgeExtension, PgRadarSelectionService } from "./radar-selection-extension.mjs";\n';

function runReadOnlySsh(command, maxBuffer = 12 * 1024 * 1024) {
  const result = spawnSync("ssh", ["meowlab", command], {
    encoding: null,
    maxBuffer,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Read-only SSH command failed (${result.status}): ${String(result.stderr).slice(0, 500)}`);
  }
  return result.stdout;
}

const liveBytes = runReadOnlySsh("docker exec manolo-platform-bridge-1 cat dist/node/server.mjs");
await fs.mkdir(actualDir, { recursive: true });
const actualPath = path.join(actualDir, "server.mjs");
try {
  const saved = await fs.readFile(actualPath);
  if (!saved.equals(liveBytes)) throw new Error("Saved actual bridge snapshot differs from the running container");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await fs.writeFile(actualPath, liveBytes, { flag: "wx" });
}
const original = liveBytes.toString("utf8");
if (original.split(sourceAnchor).length !== 2) {
  throw new Error(`Expected exactly one actual-bundle handler anchor; found ${original.split(sourceAnchor).length - 1}`);
}
let patched = original.replace(sourceAnchor, patchedAnchor);
patched = imports + patched;
const recovered = patched.slice(imports.length).replace(patchedAnchor, sourceAnchor);
if (recovered !== original) throw new Error("Bundle patch is not exactly reversible after removing the added import");

const bundled = await build({
  absWorkingDir: appRoot,
  entryPoints: ["src/node/radar/bridge-extension.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  write: false,
  sourcemap: false,
  legalComments: "none",
});
if (bundled.outputFiles.length !== 1) throw new Error("Expected one bundled RADAR bridge extension module");
const extensionBytes = bundled.outputFiles[0].contents;

const resolvedBackup = path.resolve(backupRoot);
const resolvedRelease = path.resolve(releaseDir);
const releaseRelative = path.relative(resolvedBackup, resolvedRelease);
if (!releaseRelative || releaseRelative.startsWith("..") || path.isAbsolute(releaseRelative)) {
  throw new Error("Release output escaped its dated backup directory");
}
await fs.rm(releaseDir, { recursive: true, force: true });
await fs.mkdir(path.join(releaseDir, "dist/node"), { recursive: true });
await fs.writeFile(path.join(releaseDir, serverRelativePath), patched, { flag: "wx" });
await fs.writeFile(path.join(releaseDir, "dist/node/radar-selection-extension.mjs"), extensionBytes, { flag: "wx" });
await fs.writeFile(path.join(releaseDir, "Dockerfile"), [
  `FROM ${baseImage}`,
  "COPY --chown=node:node dist/node/server.mjs /app/dist/node/server.mjs",
  "COPY --chown=node:node dist/node/radar-selection-extension.mjs /app/dist/node/radar-selection-extension.mjs",
  "USER node",
  "CMD [\"node\", \"dist/node/server.mjs\"]",
  "",
].join("\n"), { flag: "wx" });

const digest = (value) => createHash("sha256").update(value).digest("hex");
const manifest = {
  source: "read-only snapshot from manolo-platform-bridge-1:/app/dist/node/server.mjs",
  baseImage,
  sourceAnchor,
  patchedAnchor,
  snapshotSha256: digest(liveBytes),
  patchedServerSha256: digest(patched),
  extensionSha256: digest(extensionBytes),
  reversibleExactAnchorPatch: true,
  preservationEvidence: "After removing only the new import and restoring the unique handler call anchor, the complete 89 KB source bundle is byte-for-byte identical to the live snapshot.",
  scope: ["Add authenticated RADAR selection route wrapper", "Reuse the existing signed bridge HMAC contract", "Preserve legacy handler behavior for every other path"],
  excluded: ["No migration", "No compose changes", "No deployment", "No remote writes"],
};
await fs.writeFile(path.join(releaseDir, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ releaseDir, snapshotSha256: manifest.snapshotSha256, patchedServerSha256: manifest.patchedServerSha256, extensionSha256: manifest.extensionSha256, reversibleExactAnchorPatch: true }));
