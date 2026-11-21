import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const portalDir = path.resolve(mobileDir, "..", "meowlab-app");
const apiOrigin = (process.env.VITE_API_ORIGIN ?? "https://app.meowlab.tech").trim();

execSync("npm run build", {
  cwd: portalDir,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_API_ORIGIN: apiOrigin,
  },
});
