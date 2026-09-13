import { createServer, type IncomingHttpHeaders } from "node:http";
import { readFileSync } from "node:fs";
import { createAiProvider } from "../adapters/ai/factory";
import {
  CONTACT_ROLE_RESOLUTION_PATH,
  PLATFORM_INBOUND_SYNC_PATH,
  PLATFORM_OUTBOUND_SYNC_PATH,
  PRINT_ADVISOR_BRIDGE_PATH,
} from "../bridge/contracts";
import { createBridgeHttpHandler } from "./bridge/http-handler";
import { PgBridgeRequestStore } from "./bridge/pg-request-store";
import { PrintAdvisorBridgeService } from "./bridge/print-advisor-service";
import { PgContactRoleResolver } from "./control/pg-contact-role-resolver";
import { PlatformSyncService } from "./platform/platform-sync-service";
import { createPrintPostgresConnection } from "./postgres/pg-read-only-executor";
import { FACTURAYA_BRIDGE_PATH } from "../facturaya/bridge-contracts";
import { CredentialCipher } from "./security/credential-cipher";
import { PgFacturayaTenantRepository } from "./facturaya/tenant-repository";
import { FacturayaOperationService } from "./facturaya/operation-service";

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const DEFAULT_PORT = 3_000;

function logSafeEvent(
  event: string,
  details: Record<string, unknown> = {},
): void {
  console.log(JSON.stringify({ event, ...details, at: new Date().toISOString() }));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredSecret(name: string, fileName: string): string {
  const directValue = process.env[name]?.trim();
  if (directValue) return directValue;

  const path = process.env[fileName]?.trim();
  if (!path) {
    throw new Error(`Missing required secret: ${name} or ${fileName}`);
  }
  const fileValue = readFileSync(path, "utf8").trim();
  if (!fileValue) throw new Error(`Secret file is empty: ${fileName}`);
  return fileValue;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? DEFAULT_PORT);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : DEFAULT_PORT;
}

function normalizedHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      Array.isArray(value) ? value.join(",") : value,
    ]),
  );
}

async function readRequestBody(
  request: AsyncIterable<Uint8Array>,
): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const sharedSecret = process.env.VPS_BRIDGE_HMAC_SECRET?.trim()
    || process.env.VPS_BRIDGE_SECRET?.trim()
    || requiredSecret(
      "VPS_BRIDGE_HMAC_SECRET",
      process.env.VPS_BRIDGE_HMAC_SECRET_FILE
        ? "VPS_BRIDGE_HMAC_SECRET_FILE"
        : "VPS_BRIDGE_SECRET_FILE",
    );
  const credentialsEncryptionKey = requiredSecret(
    "CREDENTIALS_ENCRYPTION_KEY",
    "CREDENTIALS_ENCRYPTION_KEY_FILE",
  );
  const facturayaBaseUrl = requiredEnvironment("FACTURAYA_BASE_URL").replace(/\/$/, "");
  if (new URL(facturayaBaseUrl).protocol !== "https:") {
    throw new Error("FACTURAYA_BASE_URL must use HTTPS");
  }
  const groqApiKey = requiredSecret("GROQ_API_KEY", "GROQ_API_KEY_FILE");
  if (sharedSecret.length < 32) {
    throw new Error("VPS_BRIDGE_HMAC_SECRET must contain at least 32 characters");
  }

  const connection = createPrintPostgresConnection(databaseUrl, logSafeEvent);
  if (!connection) throw new Error("PostgreSQL connection could not be created");
  const ai = createAiProvider("groq", { groqApiKey });
  if (!ai) throw new Error("Groq provider could not be created");

  const requestStore = new PgBridgeRequestStore(connection.pool);
  const contactRoleResolver = new PgContactRoleResolver(connection.pool);
  const platformSyncService = new PlatformSyncService(connection.pool);
  const facturayaRepository = new PgFacturayaTenantRepository(connection.pool);
  const facturayaService = new FacturayaOperationService(
    facturayaRepository,
    requestStore,
    new CredentialCipher(credentialsEncryptionKey),
    facturayaBaseUrl,
    logSafeEvent,
  );
  const service = new PrintAdvisorBridgeService(
    ai,
    connection.repository,
    requestStore,
    logSafeEvent,
    { aiModel: process.env.PRINT_ADVISOR_MODEL },
  );
  const handler = createBridgeHttpHandler({
    sharedSecret,
    service,
    contactRoleResolver,
    platformSyncService,
    facturayaService,
    log: logSafeEvent,
    healthCheck: async () => {
      try {
        await connection.pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
  });

  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    if (body === null) {
      response.writeHead(413, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "request_too_large" }));
      return;
    }
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const result = await handler({
      method: request.method ?? "GET",
      path,
      headers: normalizedHeaders(request.headers),
      body,
    });
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  const port = parsePort(process.env.PORT);
  server.listen(port, "0.0.0.0", () => {
    logSafeEvent("vps_bridge_started", {
      port,
      routes: [
        "/health",
        PRINT_ADVISOR_BRIDGE_PATH,
        CONTACT_ROLE_RESOLUTION_PATH,
        PLATFORM_INBOUND_SYNC_PATH,
        PLATFORM_OUTBOUND_SYNC_PATH,
        FACTURAYA_BRIDGE_PATH,
      ],
    });
  });

  const shutdown = async (signal: string) => {
    logSafeEvent("vps_bridge_stopping", { signal });
    server.close();
    await connection.close();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(JSON.stringify({ event: "vps_bridge_startup_failed", message }));
  process.exitCode = 1;
});
