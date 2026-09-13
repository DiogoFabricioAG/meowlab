import { describe, expect, it, vi } from "vitest";
import { SignedVpsBridgeClient } from "../src/adapters/bridge/signed-vps-client";
import {
  BRIDGE_PROTOCOL_VERSION,
  CONTACT_ROLE_RESOLUTION_PATH,
  createContactRoleResolutionRequest,
  createPrintAdvisorBridgeRequest,
  type PrintAdvisorBridgeRequest,
} from "../src/bridge/contracts";
import { signBridgePayload } from "../src/bridge/signature";
import { createBridgeHttpHandler } from "../src/node/bridge/http-handler";
import { PrintAdvisorBridgeService } from "../src/node/bridge/print-advisor-service";
import type {
  BridgeRequestClaim,
  BridgeRequestIdentity,
  BridgeRequestStore,
} from "../src/node/bridge/request-store";
import { verifyBridgeSignature } from "../src/node/bridge/signature-verifier";
import type { AiProvider } from "../src/ai/contracts";
import type { TenantContext } from "../src/roles/contracts";

const secret = "bridge-secret-with-at-least-thirty-two-characters";
const contactRoleResolver = {
  resolve: vi.fn(async () => ({
    roleKey: "enterprise-advisor",
    source: "contact" as const,
  })),
};

const tenant: TenantContext = {
  tenantId: "manolo",
  phoneNumberId: "1266091906580349",
  roleKey: "print-advisor",
  systemPrompt: "Eres un asesor del negocio.",
  aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b",
  temperature: 0.2,
  maxTokens: 1_500,
};

function bridgeRequest(requestId = "wamid.bridge-1"): PrintAdvisorBridgeRequest {
  return createPrintAdvisorBridgeRequest(
    requestId,
    {
      id: requestId,
      interactionId: null,
      phoneNumberId: tenant.phoneNumberId,
      to: "51999999999",
      inputType: "text",
      text: "¿Cómo fueron las ventas de esta semana?",
    },
    tenant,
    [{ role: "user", content: "Hola" }],
  );
}

class MemoryBridgeRequestStore implements BridgeRequestStore {
  private readonly values = new Map<
    string,
    { hash: string; status: "processing" | "completed"; replyText?: string }
  >();

  async claim(identity: BridgeRequestIdentity): Promise<BridgeRequestClaim> {
    const current = this.values.get(identity.requestId);
    if (!current) {
      this.values.set(identity.requestId, {
        hash: identity.requestHash,
        status: "processing",
      });
      return { status: "claimed" };
    }
    if (current.hash !== identity.requestHash) return { status: "conflict" };
    return current.status === "completed" && current.replyText
      ? { status: "completed", replyText: current.replyText }
      : { status: "in_progress" };
  }

  async complete(
    identity: BridgeRequestIdentity,
    replyText: string,
  ): Promise<void> {
    this.values.set(identity.requestId, {
      hash: identity.requestHash,
      status: "completed",
      replyText,
    });
  }

  async fail(identity: BridgeRequestIdentity): Promise<void> {
    this.values.delete(identity.requestId);
  }
}

function createService() {
  const completeWithTools = vi.fn(async () => ({
    content: JSON.stringify({
      type: "text",
      message: "Esta semana vendiste S/ 1,250.00.",
      data: {},
    }),
    toolCalls: [],
  }));
  const ai: AiProvider = {
    key: "groq",
    complete: vi.fn(async () => null),
    completeWithTools,
  };
  const service = new PrintAdvisorBridgeService(
    ai,
    { dialect: "postgres", executeReadOnlyQuery: async () => ({ rows: [] }) },
    new MemoryBridgeRequestStore(),
    vi.fn(),
  );
  return { service, completeWithTools };
}

describe("signed Worker to VPS bridge", () => {
  it("signs the exact body and accepts a bounded response", async () => {
    const request = bridgeRequest();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      expect(
        verifyBridgeSignature(
          body,
          headers.get("X-Manolo-Timestamp") ?? undefined,
          headers.get("X-Manolo-Signature") ?? undefined,
          secret,
        ),
      ).toEqual({ valid: true });
      expect(headers.get("X-Manolo-Request-Id")).toBe(request.requestId);
      return Response.json({
        version: BRIDGE_PROTOCOL_VERSION,
        requestId: request.requestId,
        replyText: "Respuesta desde PostgreSQL",
        replayed: false,
      });
    });
    const client = new SignedVpsBridgeClient(
      "https://facturas.example/internal/manolo",
      secret,
      vi.fn(),
      fetcher,
    );

    await expect(client.requestPrintAdvisorReply(request)).resolves.toMatchObject({
      replyText: "Respuesta desde PostgreSQL",
      replayed: false,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns null when the VPS response does not match the request", async () => {
    const request = bridgeRequest();
    const client = new SignedVpsBridgeClient(
      "https://facturas.example/internal/manolo",
      secret,
      vi.fn(),
      async () => Response.json({
        version: 1,
        requestId: "another-request",
        replyText: "wrong response",
        replayed: false,
      }),
    );

    await expect(client.requestPrintAdvisorReply(request)).resolves.toBeNull();
  });

  it("replays a completed request without invoking the model twice", async () => {
    const { service, completeWithTools } = createService();
    const request = bridgeRequest();

    const first = await service.process(request, "a".repeat(64));
    const second = await service.process(request, "a".repeat(64));

    expect(first).toMatchObject({
      status: "completed",
      response: { replayed: false },
    });
    expect(second).toMatchObject({
      status: "completed",
      response: { replayed: true },
    });
    expect(completeWithTools).toHaveBeenCalledOnce();
  });

  it("rejects an expired HMAC before processing JSON", async () => {
    const { service } = createService();
    const body = JSON.stringify(bridgeRequest());
    const oldTimestamp = "1700000000";
    const signature = await signBridgePayload(secret, oldTimestamp, body);
    const handler = createBridgeHttpHandler({
      sharedSecret: secret,
      service,
      contactRoleResolver,
      healthCheck: async () => true,
      log: vi.fn(),
      nowSeconds: () => Number(oldTimestamp) + 301,
    });

    const response = await handler({
      method: "POST",
      path: "/v1/roles/print-advisor/respond",
      headers: {
        "x-manolo-request-id": "wamid.bridge-1",
        "x-manolo-timestamp": oldTimestamp,
        "x-manolo-signature": signature,
      },
      body,
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: "unauthorized" });
  });

  it("serves a signed request and a database-backed health check", async () => {
    const { service } = createService();
    const request = bridgeRequest("wamid.bridge-health");
    const body = JSON.stringify(request);
    const timestamp = "1700000000";
    const signature = await signBridgePayload(secret, timestamp, body);
    const handler = createBridgeHttpHandler({
      sharedSecret: secret,
      service,
      contactRoleResolver,
      healthCheck: async () => true,
      log: vi.fn(),
      nowSeconds: () => Number(timestamp),
    });

    const health = await handler({
      method: "GET",
      path: "/health",
      headers: {},
      body: "",
    });
    const response = await handler({
      method: "POST",
      path: "/v1/roles/print-advisor/respond",
      headers: {
        "x-manolo-request-id": request.requestId,
        "x-manolo-timestamp": timestamp,
        "x-manolo-signature": signature,
      },
      body,
    });

    expect(health.status).toBe(200);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      requestId: request.requestId,
      replyText: "Esta semana vendiste S/ 1,250.00.",
      replayed: false,
    });
  });

  it("resolves a contact role through the same signed channel", async () => {
    const { service } = createService();
    const request = createContactRoleResolutionRequest(
      "wamid.role-1",
      {
        id: "wamid.role-1",
        interactionId: null,
        phoneNumberId: tenant.phoneNumberId,
        to: "51999999999",
        inputType: "text",
        text: "hola",
      },
      tenant,
    );
    const body = JSON.stringify(request);
    const timestamp = "1700000000";
    const signature = await signBridgePayload(secret, timestamp, body);
    const resolver = {
      resolve: vi.fn(async () => ({
        roleKey: "enterprise-advisor",
        source: "contact" as const,
      })),
    };
    const handler = createBridgeHttpHandler({
      sharedSecret: secret,
      service,
      contactRoleResolver: resolver,
      healthCheck: async () => true,
      log: vi.fn(),
      nowSeconds: () => Number(timestamp),
    });

    const response = await handler({
      method: "POST",
      path: CONTACT_ROLE_RESOLUTION_PATH,
      headers: {
        "x-manolo-request-id": request.requestId,
        "x-manolo-timestamp": timestamp,
        "x-manolo-signature": signature,
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      version: BRIDGE_PROTOCOL_VERSION,
      requestId: request.requestId,
      roleKey: "enterprise-advisor",
      source: "contact",
    });
    expect(resolver.resolve).toHaveBeenCalledWith(request);
  });

  it("uses the signed client for contact role resolution", async () => {
    const request = createContactRoleResolutionRequest(
      "wamid.role-client",
      {
        id: "wamid.role-client",
        interactionId: null,
        phoneNumberId: tenant.phoneNumberId,
        to: "51999999999",
        inputType: "text",
        text: "hola",
      },
      tenant,
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain(CONTACT_ROLE_RESOLUTION_PATH);
      const headers = new Headers(init?.headers);
      expect(verifyBridgeSignature(
        String(init?.body),
        headers.get("X-Manolo-Timestamp") ?? undefined,
        headers.get("X-Manolo-Signature") ?? undefined,
        secret,
      )).toEqual({ valid: true });
      return Response.json({
        version: BRIDGE_PROTOCOL_VERSION,
        requestId: request.requestId,
        roleKey: "enterprise-advisor",
        source: "contact",
      });
    });
    const client = new SignedVpsBridgeClient(
      "https://facturas.example/internal/manolo",
      secret,
      vi.fn(),
      fetcher,
    );

    await expect(client.resolveContactRole(request)).resolves.toMatchObject({
      roleKey: "enterprise-advisor",
      source: "contact",
    });
  });
});
