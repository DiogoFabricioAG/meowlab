import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createSshConnectionConfig, sshConnectionArgs } from "./ssh-config.mjs";

const MAX_SQL_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SAFE_CONTAINER = /^[a-zA-Z0-9_.-]+$/;

export function createSshPostgresConfig(environment = process.env) {
  return {
    ...createSshConnectionConfig(environment),
    container: environment.MANOLO_POSTGRES_CONTAINER?.trim()
      || "manolo-platform-postgres-1",
  };
}

export class SshPostgresGateway {
  constructor(config = createSshPostgresConfig()) {
    sshConnectionArgs(config);
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
    if (this.config.keyPath) await access(this.config.keyPath);

    const remoteCommand = [
      "docker exec -i",
      this.config.container,
      "sh -c",
      "'exec psql -v ON_ERROR_STOP=1 -X -qAt -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"'",
    ].join(" ");
    const args = [...sshConnectionArgs(this.config), remoteCommand];

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
