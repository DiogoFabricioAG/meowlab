import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_SQL_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SAFE_HOST = /^[a-zA-Z0-9@._:-]+$/;
const SAFE_CONTAINER = /^[a-zA-Z0-9_.-]+$/;

export function createSshPostgresConfig(environment = process.env) {
  return {
    host: environment.MANOLO_VPS_HOST?.trim() || "root@2.24.64.161",
    keyPath: environment.MANOLO_VPS_SSH_KEY?.trim()
      || path.join(os.homedir(), ".ssh", "facturaya_hostinger_ed25519"),
    container: environment.MANOLO_POSTGRES_CONTAINER?.trim()
      || "manolo-platform-postgres-1",
  };
}

export class SshPostgresGateway {
  constructor(config = createSshPostgresConfig()) {
    if (!SAFE_HOST.test(config.host)) {
      throw new Error("MANOLO_VPS_HOST contiene caracteres no permitidos.");
    }
    if (!SAFE_CONTAINER.test(config.container)) {
      throw new Error("MANOLO_POSTGRES_CONTAINER no es válido.");
    }
    this.config = config;
  }

  async query(sql) {
    const sqlBytes = Buffer.byteLength(sql, "utf8");
    if (sqlBytes === 0 || sqlBytes > MAX_SQL_BYTES) {
      throw new Error("La consulta SQL está vacía o excede el límite permitido.");
    }
    await access(this.config.keyPath);

    const remoteCommand = [
      "docker exec -i",
      this.config.container,
      "sh -c",
      "'exec psql -v ON_ERROR_STOP=1 -X -qAt -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"'",
    ].join(" ");
    const args = [
      "-i",
      this.config.keyPath,
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=2",
      this.config.host,
      remoteCommand,
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("ssh", args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let outputExceeded = false;

      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          outputExceeded = true;
          child.kill();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes <= MAX_OUTPUT_BYTES) stderr.push(chunk);
      });
      child.on("error", (error) => reject(new Error(
        `No se pudo iniciar SSH: ${error.message}`,
      )));
      child.on("close", (code) => {
        if (outputExceeded) {
          reject(new Error("PostgreSQL devolvió demasiada información."));
          return;
        }
        const errorText = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0) {
          reject(new Error(
            errorText || `La conexión SSH terminó con código ${code}.`,
          ));
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8").trim());
      });

      child.stdin.end(sql.endsWith("\n") ? sql : `${sql}\n`);
    });
  }
}
