import { PgPortalLinkStore, PortalLinkService, type PortalLinkPool } from "./portal/link-service";
import { WorkerAuthCodeSender } from "./portal/auth-code-sender";
import { PortalBillingService, type BillingPool } from "./portal/billing-service";
import { FacturayaTaxpayerDirectory, PortalCompanyService } from "./portal/company-service";
import { PortalInvitationService } from "./portal/invitation-service";
import { PortalWeeklyService } from "./portal/weekly-service";
import { PortalEntitlementService } from "./portal/entitlement-service";
import { SalesService } from "./sales/sales-service";
import { FacturayaIssuedDocumentReader, StockService } from "./stock/stock-service";
import { PortalStockService } from "./stock/portal-stock-service";
import { FacturayaQuotePdfRenderer, QuotePdfService } from "./sales/quote-pdf-service";
import { SALES_BRIDGE_PATH } from "../sales/bridge-contracts";
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
import { advisorConnectionString } from "./postgres/advisor-connection";
import { createPrintPostgresConnection } from "./postgres/pg-read-only-executor";
import { FACTURAYA_BRIDGE_PATH } from "../facturaya/bridge-contracts";
import { CredentialCipher } from "./security/credential-cipher";
import { PgFacturayaTenantRepository } from "./facturaya/tenant-repository";
import { FacturayaOperationService } from "./facturaya/operation-service";
import { PgRadarSelectionService } from "./radar/selection-service";
import { RADAR_SYNC_BRIDGE_PATH } from "../radar/sync-contracts";

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

/**
 * Portal app.meowlab.tech (ADR-0006). Optional: without its secrets the portal route
 * answers 503 and the rest of the bridge is unaffected.
 */
function portalLinkDependencies(pool: PortalLinkPool & BillingPool, cipher: CredentialCipher, facturayaBaseUrl: string,
  stock: StockService | null = null) {
  const portalSecret = optionalSecret("PORTAL_BRIDGE_HMAC_SECRET", "PORTAL_BRIDGE_HMAC_SECRET_FILE");
  const authCodeSecret = optionalSecret("AUTH_CODE_HMAC_SECRET", "AUTH_CODE_HMAC_SECRET_FILE");
  const workerUrl = process.env.MANOLO_WORKER_URL?.trim().replace(/\/$/, "");
  if (!portalSecret || !authCodeSecret || !workerUrl) {
    logSafeEvent("vps_portal_link_disabled");
    return {};
  }
  if (portalSecret.length < 32 || authCodeSecret.length < 32) {
    throw new Error("Portal secrets must contain at least 32 characters");
  }
  if (new URL(workerUrl).protocol !== "https:") throw new Error("MANOLO_WORKER_URL must use HTTPS");
  return {
    portalSecret,
    // Phase 3: read-only billing data through FacturaYa, authorized per linked number.
    portalBillingService: new PortalBillingService(pool, cipher, facturayaBaseUrl, logSafeEvent),
    // ADR-0010: companies created from the portal; RUC read from FacturaYa's registry.
    portalCompanyService: new PortalCompanyService(
      pool,
      taxpayerDirectory(facturayaBaseUrl),
      logSafeEvent,
      undefined,
      new PortalInvitationService(pool, logSafeEvent),
      // «Inicio»: weekly summary from FacturaYa, messages and Tender Cat.
      new PortalWeeklyService(pool, cipher, facturayaBaseUrl, logSafeEvent),
      // ADR-0014: Stock Cat's page in the portal.
      new PortalStockService(pool, stock, logSafeEvent),
    ),
    // Plan per company: what a company paid for, until the end of the paid period.
    portalEntitlementService: new PortalEntitlementService(pool, logSafeEvent),
    portalLinkService: new PortalLinkService(
      new PgPortalLinkStore(pool),
      new WorkerAuthCodeSender(workerUrl, authCodeSecret, logSafeEvent),
      portalSecret,
      logSafeEvent,
    ),
  };
}

/** Without the internal token the portal can list companies but not look up or create them. */
function taxpayerDirectory(facturayaBaseUrl: string): FacturayaTaxpayerDirectory | null {
  const token = optionalSecret("FACTURAYA_INTERNAL_TOKEN", "FACTURAYA_INTERNAL_TOKEN_FILE");
  if (!token) {
    logSafeEvent("vps_portal_taxpayer_lookup_disabled");
    return null;
  }
  return new FacturayaTaxpayerDirectory(facturayaBaseUrl, token);
}

function optionalSecret(name: string, fileName: string): string | null {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const path = process.env[fileName]?.trim();
  return path ? readFileSync(path, "utf8").trim() || null : null;
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

  // Model-generated SQL runs with its own read-only role, never with the platform's owner role.
  const advisorDatabaseUrl = advisorConnectionString(
    databaseUrl,
    process.env.PRINT_ADVISOR_DB_USER?.trim() || "manolo_advisor_ro",
    requiredSecret("PRINT_ADVISOR_DB_PASSWORD", "PRINT_ADVISOR_DB_PASSWORD_FILE"),
  );

  const connection = createPrintPostgresConnection(databaseUrl, logSafeEvent, "manolo-platform-bridge");
  if (!connection) throw new Error("PostgreSQL connection could not be created");
  const advisorConnection = createPrintPostgresConnection(advisorDatabaseUrl, logSafeEvent);
  if (!advisorConnection) throw new Error("Print advisor PostgreSQL connection could not be created");
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
    advisorConnection.repository,
    requestStore,
    logSafeEvent,
    { aiModel: process.env.PRINT_ADVISOR_MODEL },
  );
  // ADR-0013: Sales Cat quotes as PDF, drawn by FacturaYa with the single layout.
  const quotePdfToken = optionalSecret("FACTURAYA_INTERNAL_TOKEN", "FACTURAYA_INTERNAL_TOKEN_FILE");
  const quotePdfs = new QuotePdfService(
    connection.pool,
    quotePdfToken ? new FacturayaQuotePdfRenderer(facturayaBaseUrl, quotePdfToken) : null,
    logSafeEvent,
  );
  // ADR-0014: Stock Cat; documents are read from FacturaYa with each company's own token.
  const stockService = new StockService(
    connection.pool,
    requestStore,
    logSafeEvent,
    new FacturayaIssuedDocumentReader(connection.pool, new CredentialCipher(credentialsEncryptionKey), facturayaBaseUrl, logSafeEvent),
  );
  const handler = createBridgeHttpHandler({
    sharedSecret,
    service,
    contactRoleResolver,
    platformSyncService,
    facturayaService,
    radarSelectionService: new PgRadarSelectionService(connection.pool),
    // Sales Cat (ADR-0011): its data and the public quote page.
    salesService: new SalesService(connection.pool, requestStore, logSafeEvent, undefined, undefined, quotePdfs),
    quotePdfService: quotePdfs,
    stockService,
    ...portalLinkDependencies(connection.pool, new CredentialCipher(credentialsEncryptionKey), facturayaBaseUrl, stockService),
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
        RADAR_SYNC_BRIDGE_PATH,
        SALES_BRIDGE_PATH,
      ],
    });
  });

  const shutdown = async (signal: string) => {
    logSafeEvent("vps_bridge_stopping", { signal });
    server.close();
    await Promise.all([connection.close(), advisorConnection.close()]);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(JSON.stringify({ event: "vps_bridge_startup_failed", message }));
  process.exitCode = 1;
});
