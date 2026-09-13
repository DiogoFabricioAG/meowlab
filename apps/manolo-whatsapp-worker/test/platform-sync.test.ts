import { describe, expect, it } from "vitest";
import {
  BRIDGE_PROTOCOL_VERSION,
  type PlatformInboundSyncRequest,
} from "../src/bridge/contracts";
import {
  PlatformSyncConflictError,
  PlatformSyncService,
  type PlatformSyncPool,
} from "../src/node/platform/platform-sync-service";

function request(): PlatformInboundSyncRequest {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    requestId: "wamid.platform-sync-1",
    tenantId: "manolo",
    phoneNumberId: "1266091906580349",
    whatsappUserId: "51999999999",
    contactId: 7,
    conversationId: "manolo:51999999999",
    message: {
      metaMessageId: "wamid.message-1",
      messageType: "text",
      content: "hola",
      status: "received",
      createdAt: "2026-08-26T12:00:00.000Z",
    },
  };
}

function typedRow<T extends Record<string, unknown>>(
  value: Record<string, unknown>,
): T {
  return Object.assign(Object.create(null), value);
}

class FakePlatformPool implements PlatformSyncPool {
  readonly statements: string[] = [];
  private readonly keys = new Map<string, string>();

  async connect() {
    return {
      query: async <T extends Record<string, unknown> = Record<string, unknown>>(
        statement: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: T[] }> => {
        this.statements.push(statement.trim());
        if (statement.includes("SELECT request_hash, status")) {
          const key = `${values[0]}:${values[1]}:${values[2]}`;
          const hash = this.keys.get(key);
          return {
            rows: hash
              ? [typedRow<T>({ request_hash: hash, status: "completed" })]
              : [],
          };
        }
        if (statement.includes("INSERT INTO whatsapp.idempotency_keys")) {
          const key = `${values[0]}:${values[1]}:${values[2]}`;
          this.keys.set(key, String(values[3]));
        }
        if (statement.includes("RETURNING id")) {
          return { rows: [typedRow<T>({ id: 7 })] };
        }
        if (statement.includes("SELECT 1")) {
          return { rows: [typedRow<T>({ ok: 1 })] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };
  }
}

describe("PlatformSyncService", () => {
  it("persists an inbound message and makes the retry idempotent", async () => {
    const pool = new FakePlatformPool();
    const service = new PlatformSyncService(pool);

    await expect(service.syncInbound(request(), "a".repeat(64))).resolves.toEqual({
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: request().requestId,
      accepted: true,
      duplicate: false,
    });
    await expect(service.syncInbound(request(), "a".repeat(64))).resolves.toEqual({
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: request().requestId,
      accepted: true,
      duplicate: true,
    });

    expect(pool.statements.filter((statement) =>
      statement.includes("INSERT INTO whatsapp.messages"),
    )).toHaveLength(1);
  });

  it("rejects reuse of a request id with a different payload", async () => {
    const pool = new FakePlatformPool();
    const service = new PlatformSyncService(pool);
    await service.syncInbound(request(), "a".repeat(64));

    await expect(service.syncInbound(request(), "b".repeat(64)))
      .rejects.toBeInstanceOf(PlatformSyncConflictError);
  });
});
