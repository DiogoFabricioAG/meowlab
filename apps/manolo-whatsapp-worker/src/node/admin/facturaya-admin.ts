import { readFileSync } from "node:fs";
import { FacturayaApiClient } from "../../adapters/facturaya/client";
import { PgFacturayaTenantRepository } from "../facturaya/tenant-repository";
import { createPrintPostgresConnection } from "../postgres/pg-read-only-executor";
import { CredentialCipher } from "../security/credential-cipher";

const MAX_INPUT_BYTES = 16 * 1024;
const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;

type AdminCommand =
  | {
      action: "set_integration";
      tenantId: string;
      token: string;
      environment: "beta" | "production";
      status: "active" | "inactive";
    }
  | {
      action: "test_connection";
      tenantId: string;
    };

function secret(name: string, fileName: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const path = process.env[fileName]?.trim();
  if (!path) throw new Error(`missing_${name.toLowerCase()}`);
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error(`empty_${name.toLowerCase()}`);
  return value;
}

async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_INPUT_BYTES) throw new Error("admin_input_too_large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseCommand(raw: string): AdminCommand {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid_admin_command");
  }
  const command = value as Record<string, unknown>;
  const tenantId = typeof command.tenantId === "string"
    ? command.tenantId.trim()
    : "";
  if (!SAFE_TENANT_ID.test(tenantId)) throw new Error("invalid_tenant_id");
  if (command.action === "test_connection") {
    return { action: "test_connection", tenantId };
  }
  if (command.action === "set_integration") {
    const token = typeof command.token === "string" ? command.token.trim() : "";
    if (token.length < 10 || token.length > 4_096) throw new Error("invalid_token");
    if (command.environment !== "beta" && command.environment !== "production") {
      throw new Error("invalid_environment");
    }
    if (command.status !== "active" && command.status !== "inactive") {
      throw new Error("invalid_status");
    }
    return {
      action: "set_integration",
      tenantId,
      token,
      environment: command.environment,
      status: command.status,
    };
  }
  throw new Error("unsupported_admin_command");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const baseUrl = process.env.FACTURAYA_BASE_URL?.trim().replace(/\/$/, "");
  if (!databaseUrl) throw new Error("missing_database_url");
  if (!baseUrl || new URL(baseUrl).protocol !== "https:") {
    throw new Error("invalid_facturaya_base_url");
  }
  const cipher = new CredentialCipher(secret(
    "CREDENTIALS_ENCRYPTION_KEY",
    "CREDENTIALS_ENCRYPTION_KEY_FILE",
  ));
  const connection = createPrintPostgresConnection(databaseUrl, () => undefined);
  if (!connection) throw new Error("database_unavailable");
  try {
    const command = parseCommand(await readInput());
    const repository = new PgFacturayaTenantRepository(connection.pool);
    if (command.action === "set_integration") {
      await repository.saveIntegration({
        tenantId: command.tenantId,
        encryptedToken: cipher.encrypt(command.token),
        environment: command.environment,
        status: command.status,
      });
      process.stdout.write(JSON.stringify({
        ok: true,
        tenantId: command.tenantId,
        integration: "saved",
      }));
      return;
    }

    const integration = await repository.getIntegrationForAdmin(command.tenantId);
    if (!integration) throw new Error("integration_not_found");
    let token: string;
    try {
      token = cipher.decrypt(integration.encryptedToken);
    } catch {
      await repository.updateConnectionCheck(
        command.tenantId,
        "failed",
        "credential_decryption_failed",
      );
      throw new Error("credential_decryption_failed");
    }
    const client = new FacturayaApiClient(baseUrl, token, () => undefined);
    const result = await client.listInvoiceDrafts();
    if (!result.ok) {
      const message = result.message || result.reason;
      await repository.updateConnectionCheck(command.tenantId, "failed", message);
      process.stdout.write(JSON.stringify({
        ok: false,
        tenantId: command.tenantId,
        connection: "failed",
        reason: result.reason,
        ...(result.message ? { message: result.message } : {}),
      }));
      return;
    }
    await repository.updateConnectionCheck(command.tenantId, "ok", null);
    process.stdout.write(JSON.stringify({
      ok: true,
      tenantId: command.tenantId,
      connection: "ok",
      environment: integration.environment,
    }));
  } finally {
    await connection.close();
  }
}

void main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : "admin_command_failed";
  process.stdout.write(JSON.stringify({ ok: false, error: code }));
  process.exitCode = 1;
});
