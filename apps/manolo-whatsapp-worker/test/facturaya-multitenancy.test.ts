import { afterEach, describe, expect, it, vi } from "vitest";
import { SignedVpsBridgeClient } from "../src/adapters/bridge/signed-vps-client";
import { VpsFacturayaClient } from "../src/adapters/facturaya/vps-client";
import type { FacturayaTenantAccess } from "../src/facturaya/contracts";
import { CredentialCipher } from "../src/node/security/credential-cipher";
import { FacturayaOperationService } from "../src/node/facturaya/operation-service";
import type {
  BridgeRequestClaim,
  BridgeRequestIdentity,
  BridgeRequestStore,
} from "../src/node/bridge/request-store";

const masterKey = Buffer.alloc(32, 7).toString("base64");

afterEach(() => {
  vi.unstubAllGlobals();
});

const authorizedAccess: FacturayaTenantAccess = {
  status: "authorized",
  tenant: {
    id: "company-a",
    name: "Company A",
    legalName: "Company A S.A.C.",
    ruc: "20123456789",
    address: null,
    environment: "production",
    permissions: ["view_invoice", "create_invoice", "issue_invoice"],
  },
  tenants: [],
};

class MemoryRequestStore implements BridgeRequestStore {
  private readonly rows = new Map<string, { hash: string; response?: string }>();

  async claim(identity: BridgeRequestIdentity): Promise<BridgeRequestClaim> {
    const current = this.rows.get(identity.requestId);
    if (!current) {
      this.rows.set(identity.requestId, { hash: identity.requestHash });
      return { status: "claimed" };
    }
    if (current.hash !== identity.requestHash) return { status: "conflict" };
    return current.response
      ? { status: "completed", replyText: current.response }
      : { status: "in_progress" };
  }

  async complete(identity: BridgeRequestIdentity, replyText: string): Promise<void> {
    this.rows.set(identity.requestId, { hash: identity.requestHash, response: replyText });
  }

  async fail(identity: BridgeRequestIdentity): Promise<void> {
    this.rows.delete(identity.requestId);
  }
}

describe("FacturaYa multiempresa", () => {
  it("encrypts each token with authenticated random encryption", () => {
    const cipher = new CredentialCipher(masterKey);
    const first = cipher.encrypt("company-token-secret");
    const second = cipher.encrypt("company-token-secret");

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe("company-token-secret");
    expect(() => cipher.decrypt(`${first.slice(0, -1)}x`)).toThrow();
    expect(first).not.toContain("company-token-secret");
  });

  it("sends tenant context through HMAC without a company token", async () => {
    const bodies: Record<string, unknown>[] = [];
    const bridge = new SignedVpsBridgeClient(
      "https://facturas.example/internal/manolo",
      "a-secure-bridge-secret-with-32-characters",
      vi.fn(),
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const requestId = new Headers(init?.headers).get("X-Manolo-Request-Id") ?? "";
        if (body.operation === "resolve_tenant") {
          return Response.json({
            request_id: requestId,
            ok: true,
            data: authorizedAccess,
            replayed: false,
          });
        }
        return Response.json({
          request_id: requestId,
          ok: true,
          data: { ruc: "20557288016", name: "AGU BELLO E.I.R.L." },
          replayed: false,
        });
      },
    );
    const client = new VpsFacturayaClient(
      bridge,
      "manolo",
      7,
      "wamid.multiempresa",
      vi.fn(),
    );

    await expect(client.lookupCustomer("20557288016")).resolves.toMatchObject({
      ok: true,
      data: { name: "AGU BELLO E.I.R.L." },
    });
    expect(bodies[0]).toEqual({
      tenant_id: "manolo",
      contact_id: 7,
      operation: "resolve_tenant",
    });
    expect(bodies[1]).toMatchObject({
      tenant_id: "company-a",
      contact_id: 7,
      operation: "lookup_customer",
    });
    expect(JSON.stringify(bodies)).not.toContain("token");
  });

  it("replays a tenant resolution with the same idempotency key", async () => {
    const repository = {
      resolveAccess: vi.fn(async () => authorizedAccess),
    };
    const service = new FacturayaOperationService(
      repository as never,
      new MemoryRequestStore(),
      new CredentialCipher(masterKey),
      "https://facturas.example",
      vi.fn(),
    );
    const request = {
      tenant_id: "manolo",
      contact_id: 7,
      operation: "resolve_tenant" as const,
    };

    const first = await service.process(request, "request-1", "a".repeat(64));
    const second = await service.process(request, "request-1", "a".repeat(64));

    expect(first).toMatchObject({ status: "completed", response: { replayed: false } });
    expect(second).toMatchObject({ status: "completed", response: { replayed: true } });
    expect(repository.resolveAccess).toHaveBeenCalledOnce();
  });

  it("forwards an anonymous boleta payload without customer data", async () => {
    const forms: FormData[] = [];
    const repository = {
      resolveIntegration: vi.fn(async () => ({
        tenant: authorizedAccess.tenant,
        encryptedToken: new CredentialCipher(masterKey).encrypt("company-token"),
      })),
      recordAudit: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body instanceof FormData) forms.push(init.body);
      return new Response(JSON.stringify({
        data: { id: "draft-anonymous", status: "review_required", document_type: "03" },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(
      repository as never,
      new MemoryRequestStore(),
      new CredentialCipher(masterKey),
      "https://facturas.example",
      vi.fn(),
    );

    const result = await service.process({
      tenant_id: "company-a",
      contact_id: 7,
      operation: "import_invoice_draft",
      payload: {
        documentType: "03",
        customerDocumentType: "0",
        customerRuc: null,
        customerName: null,
        issueDate: "2026-09-02",
        taxMode: "included",
        productsText: "1 accesorio a S/ 50",
      },
    }, "request-anonymous-boleta", "b".repeat(64));

    expect(result).toMatchObject({
      status: "completed",
      response: { ok: true, data: { id: "draft-anonymous" } },
    });
    expect(forms).toHaveLength(1);
    expect(forms[0].get("document_type")).toBe("03");
    expect(forms[0].get("customer_document_type")).toBe("0");
    expect(forms[0].get("customer_ruc")).toBeNull();
    expect(forms[0].get("customer_name")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://facturas.example/api/invoice-drafts/import",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards an optional name for an anonymous boleta", async () => {
    const forms: FormData[] = [];
    const repository = {
      resolveIntegration: vi.fn(async () => ({
        tenant: authorizedAccess.tenant,
        encryptedToken: new CredentialCipher(masterKey).encrypt("company-token"),
      })),
      recordAudit: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body instanceof FormData) forms.push(init.body);
      return new Response(JSON.stringify({
        data: { id: "draft-anonymous-named", status: "review_required", document_type: "03" },
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(
      repository as never,
      new MemoryRequestStore(),
      new CredentialCipher(masterKey),
      "https://facturas.example",
      vi.fn(),
    );

    const result = await service.process({
      tenant_id: "company-a",
      contact_id: 7,
      operation: "import_invoice_draft",
      payload: {
        documentType: "03",
        customerDocumentType: "0",
        customerRuc: null,
        customerName: "Patricia M",
        issueDate: "2026-09-12",
        taxMode: "included",
        productsText: "Servicio de bordados, 40 unidades, precio total 125 soles",
      },
    }, "request-anonymous-boleta-named", "c".repeat(64));

    expect(result).toMatchObject({
      status: "completed",
      response: { ok: true, data: { id: "draft-anonymous-named" } },
    });
    expect(forms).toHaveLength(1);
    expect(forms[0].get("customer_document_type")).toBe("0");
    expect(forms[0].get("customer_ruc")).toBeNull();
    expect(forms[0].get("customer_name")).toBe("Patricia M");
  });
});
