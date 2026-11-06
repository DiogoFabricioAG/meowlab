import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createSshConnectionConfig, sshConnectionArgs } from "./ssh-config.mjs";

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const SAFE_CONTAINER = /^[a-zA-Z0-9_.-]+$/;

export class SshBridgeAdminGateway {
  constructor(environment = process.env) {
    const connection = createSshConnectionConfig(environment);
    this.host = connection.host;
    this.keyPath = connection.keyPath;
    this.container = environment.MANOLO_BRIDGE_CONTAINER?.trim()
      || "manolo-platform-bridge-1";
    sshConnectionArgs(this);
    if (!SAFE_CONTAINER.test(this.container)) throw new Error("MANOLO_BRIDGE_CONTAINER no es válido.");
  }

  async execute(command) {
    const input = JSON.stringify(command);
    if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
      throw new Error("El comando administrativo excede el límite permitido.");
    }
    if (this.keyPath) await access(this.keyPath);
    const args = [
      ...sshConnectionArgs(this),
      `docker exec -i ${this.container} node dist/node/facturaya-admin.mjs`,
    ];
    const output = await new Promise((resolve, reject) => {
      const child = spawn("ssh", args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout = [];
      const stderr = [];
      let total = 0;
      child.stdout.on("data", (chunk) => {
        total += chunk.byteLength;
        if (total > MAX_OUTPUT_BYTES) {
          child.kill();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        const text = Buffer.concat(stdout).toString("utf8").trim();
        if (total > MAX_OUTPUT_BYTES) {
          reject(new Error("El VPS devolvió demasiada información."));
          return;
        }
        if (code !== 0 && !text) {
          reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || "Falló el comando administrativo."));
          return;
        }
        resolve(text);
      });
      child.stdin.end(input);
    });
    try {
      return JSON.parse(output);
    } catch {
      throw new Error("El VPS devolvió una respuesta administrativa inválida.");
    }
  }
}
