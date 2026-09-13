import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { sqlLiteral } from "./contact-admin-repository.mjs";

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const DATABASE_NAME = "whatsapp-webhook-meta-db";

async function runWrangler(args) {
  const wranglerEntry = path.join(
    ROOT_DIR,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  return execFileAsync(process.execPath, [wranglerEntry, ...args], {
    cwd: ROOT_DIR,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
}

function parseWranglerJson(stdout) {
  const firstBracket = stdout.indexOf("[");
  const lastBracket = stdout.lastIndexOf("]");
  if (firstBracket < 0 || lastBracket < firstBracket) {
    throw new Error("Wrangler no devolvió una respuesta JSON válida.");
  }
  const payload = JSON.parse(stdout.slice(firstBracket, lastBracket + 1));
  if (!Array.isArray(payload) || payload.some((result) => !result?.success)) {
    throw new Error("D1 rechazó la sincronización del rol.");
  }
  return payload;
}

export class D1RoleMirror {
  constructor({ runner = runWrangler, enabled = true } = {}) {
    this.runner = runner;
    this.enabled = enabled;
  }

  async mirror(contact, roleKey) {
    if (!this.enabled) return { status: "disabled" };
    const roleValue = roleKey === null ? "NULL" : sqlLiteral(roleKey);
    const sql = `
      UPDATE contacts
      SET active_role_key = ${roleValue},
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${sqlLiteral(contact.tenantId)}
        AND whatsapp_user_id = ${sqlLiteral(contact.whatsappUserId)};
      SELECT active_role_key
      FROM contacts
      WHERE tenant_id = ${sqlLiteral(contact.tenantId)}
        AND whatsapp_user_id = ${sqlLiteral(contact.whatsappUserId)}
      LIMIT 1;
    `;
    let stdout;
    try {
      ({ stdout } = await this.runner([
        "d1",
        "execute",
        DATABASE_NAME,
        "--remote",
        "--json",
        "--command",
        sql,
      ]));
    } catch (error) {
      const details = error?.stderr ? ` ${String(error.stderr).trim()}` : "";
      throw new Error(`No se pudo sincronizar el fallback D1.${details}`);
    }

    const payload = parseWranglerJson(stdout);
    const verification = payload.at(-1)?.results?.[0];
    const mirroredRole = verification?.active_role_key ?? null;
    if (mirroredRole !== roleKey) {
      throw new Error("D1 no confirmó el rol sincronizado.");
    }
    return { status: "mirrored" };
  }
}
