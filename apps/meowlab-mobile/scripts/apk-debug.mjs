import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const androidDir = path.join(mobileDir, "android");
const isWin = process.platform === "win32";
const gradlew = isWin ? "gradlew.bat" : "./gradlew";

const env = { ...process.env };
if (!env.JAVA_HOME) {
  const jbrWin = "C:\\Program Files\\Android\\Android Studio\\jbr";
  if (isWin && fs.existsSync(jbrWin)) env.JAVA_HOME = jbrWin;
}
if (!env.ANDROID_HOME && isWin) {
  const sdkWin = path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
  if (fs.existsSync(sdkWin)) env.ANDROID_HOME = sdkWin;
}

execSync(`${gradlew} assembleDebug`, {
  cwd: androidDir,
  stdio: "inherit",
  env,
});
