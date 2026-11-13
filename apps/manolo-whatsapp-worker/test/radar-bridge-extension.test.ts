import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RADAR_SYNC_BRIDGE_PATH,
  type RadarSyncRequest,
} from "../src/radar/sync-contracts";
import { createRadarBridgeExtension } from "../src/node/radar/bridge-extension";

const secret = "test-bridge-secret-that-is-at-least-32-characters";
const now = 1_800_000_000;
const payload: RadarSyncRequest = {
  version: 1,
  requestId: "radar-req-1",
  tenantId: "tenant-a",
  phoneNumberId: "123456789012345",
  whatsappUserId: "51999999999",
  installationId: "install-a",
  operation: "publish_candidates",
  candidates: [{
    alert: {
      ocid: "ocds-5wno2w-123456789",
      code: "AS-10-2026",
      description: "Compra pública de prueba",
      buyer: "Entidad de prueba",
      amount: "S/ 12,000",
      deadline: "2026-11-10",
      sourceUrl: "https://contratacionesabiertas.oece.gob.pe",
    },
  }],
};
const body = JSON.stringify(payload);

function signature(timestamp: string, content = body): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${content}`, "utf8").digest("hex");
  return `sha256=${digest}`;
}
function request(fields: Partial<{ path: string; method: string; body: string; timestamp: string; signed: boolean; requestId: string }> = {}) {
  const content = fields.body ?? body;
  const timestamp = fields.timestamp ?? String(now);
  return {
    method: fields.method ?? "POST",
    path: fields.path ?? RADAR_SYNC_BRIDGE_PATH,
    body: content,
    headers: {
      "x-manolo-timestamp": timestamp,
      "x-manolo-signature": fields.signed === false ? "sha256=" + "0".repeat(64) : signature(timestamp, content),
      "x-manolo-request-id": fields.requestId ?? payload.requestId,
    },
  };
}
function responseBody(result: { body: string }) { return JSON.parse(result.body); }

describe("createRadarBridgeExtension", () => {
  it("checks signature, timestamp, header request ID, and strict operation before calling the service", async () => {
    const execute = vi.fn(async () => ({ version: 1 as const, requestId: payload.requestId, status: "ok" as const }));
    const delegated = vi.fn(async () => ({ status: 200, headers: {}, body: "legacy" }));
    const factory = vi.fn(() => delegated);
    const handler = createRadarBridgeExtension(factory, { execute }, { sharedSecret: secret, nowSeconds: () => now });

    expect((await handler(request({ signed: false }))).status).toBe(401);
    expect((await handler(request({ timestamp: String(now - 301) }))).status).toBe(401);
    expect((await handler(request({ requestId: "different" }))).status).toBe(400);
    const invalidOperation = { ...payload, requestId: "radar-invalid", operation: "delete_everything" };
    expect((await handler(request({ body: JSON.stringify(invalidOperation), requestId: "radar-invalid" }))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("validates and dispatches the signed request with its body hash", async () => {
    const execute = vi.fn(async () => ({ version: 1 as const, requestId: payload.requestId, status: "ok" as const }));
    const handler = createRadarBridgeExtension(() => vi.fn(), { execute }, { sharedSecret: secret, nowSeconds: () => now });
    const result = await handler(request());
    expect(result.status).toBe(200);
    expect(responseBody(result)).toEqual({ version: 1, requestId: payload.requestId, status: "ok" });
    expect(execute).toHaveBeenCalledWith(payload, expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  it("delegates health and every non-RADAR route to the legacy handler", async () => {
    const delegated = vi.fn(async () => ({ status: 204, headers: { "x-existing": "kept" }, body: "legacy" }));
    const handler = createRadarBridgeExtension(() => delegated, { execute: vi.fn() }, { sharedSecret: secret });
    const legacyRequest = request({ path: "/health", method: "GET" });
    expect(await handler(legacyRequest)).toEqual({ status: 204, headers: { "x-existing": "kept" }, body: "legacy" });
    expect(delegated).toHaveBeenCalledTimes(1);
    expect(delegated).toHaveBeenCalledWith(legacyRequest);
  });

  it("returns safe unavailable responses when no service exists or service execution fails", async () => {
    const noService = createRadarBridgeExtension(() => vi.fn(), undefined, { sharedSecret: secret, nowSeconds: () => now });
    expect((await noService(request())).status).toBe(503);
    const failing = createRadarBridgeExtension(() => vi.fn(), { execute: vi.fn().mockRejectedValue(new Error("database details")) }, {
      sharedSecret: secret, nowSeconds: () => now,
    });
    const result = await failing(request());
    expect(result.status).toBe(503);
    expect(result.body).not.toContain("database details");
  });
});
