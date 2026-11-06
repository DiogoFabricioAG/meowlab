import { afterEach, describe, expect, it, vi } from "vitest";
import { SignedVpsBridgeClient } from "../src/adapters/bridge/signed-vps-client";
import { VpsFacturayaClient } from "../src/adapters/facturaya/vps-client";
import type { FacturayaTenantAccess } from "../src/facturaya/contracts";
import { CredentialCipher } from "../src/node/security/credential-cipher";
import { FacturayaOperationService } from "../src/node/facturaya/operation-service";
import { despatchPayload, guideDraft, guideId, invoiceId } from "./despatch-fixture";
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
  it("authorizes draft detail reads with view_invoice and rejects invalid draft IDs before provider calls", async () => {
    const cipher = new CredentialCipher(masterKey);
    const repository = { resolveIntegration: vi.fn(async () => ({ tenant: authorizedAccess.tenant,
      encryptedToken: cipher.encrypt("company-token") })), recordAudit: vi.fn() };
    const fetchMock = vi.fn(async () => Response.json({ data: { id: invoiceId, items: [{ description: "Chalecos", quantity: "4" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(), cipher, "https://factura.example", vi.fn());
    const request = { tenant_id: "company-a", contact_id: 7, operation: "list_invoice_drafts" as const, payload: { draftId: invoiceId } };
    expect(await service.process(request, "detail-read", "a".repeat(64))).toMatchObject({ response: { ok: true, data: [{ id: invoiceId }] } });
    expect(repository.resolveIntegration).toHaveBeenCalledWith("company-a", 7, "view_invoice");
    expect(await service.process({ ...request, payload: { draftId: "../other" } }, "bad-detail", "b".repeat(64)))
      .toMatchObject({ response: { ok: false, error: { code: "invalid_request" } } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(["other", "M1", "L"] as const)("transports GRE %s through the signed bridge with company permissions, audit and replay", async (category) => {
    const { vehicle: _vehicle, driver: _driver, ...exemptPayload } = despatchPayload;
    const payload = category === "other" ? despatchPayload : { ...exemptPayload, vehicle_category: category };
    const cipher = new CredentialCipher(masterKey);
    const repository = { resolveIntegration: vi.fn(async () => ({ tenant: authorizedAccess.tenant,
      encryptedToken: cipher.encrypt("company-token") })), recordAudit: vi.fn(async () => undefined) };
    const fetchMock = vi.fn(async (url: string) => Response.json({ data: { ...guideDraft, payload,
      status: url.endsWith("/issue") ? "pending" : url.endsWith("/status") ? "accepted" : "draft" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(), cipher, "https://factura.example", vi.fn());
    const bodies: Record<string, unknown>[] = [];
    const bridge = new SignedVpsBridgeClient("https://bridge.example", "a-secure-bridge-secret-with-32-characters", vi.fn(), async (_url, init) => {
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      const requestId = new Headers(init?.headers).get("X-Manolo-Request-Id")!;
      if (body.operation === "resolve_tenant") return Response.json({ request_id: requestId, ok: true, data: authorizedAccess, replayed: false });
      const result = await service.process(body, requestId, "a".repeat(64));
      if (result.status !== "completed") throw Error("Unexpected conflict");
      return Response.json(result.response);
    });
    const client = new VpsFacturayaClient(bridge, "manolo", 7, "gre-turn", vi.fn());
    const input = { ...payload, idempotency_key: "gre:revision-1" };
    await expect(client.despatch.create(input)).resolves.toMatchObject({ ok: true, data: { id: guideId } });
    await client.despatch.create(input);
    expect(fetchMock).toHaveBeenCalledOnce();
    await client.despatch.issue(guideId, guideDraft.confirmation_digest);
    await client.despatch.issue(guideId, guideDraft.confirmation_digest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await client.despatch.get(guideId);
    await client.despatch.refresh(guideId);
    expect(repository.resolveIntegration).toHaveBeenCalledWith("company-a", 7, "create_invoice");
    expect(repository.resolveIntegration).toHaveBeenCalledWith("company-a", 7, "issue_invoice");
    expect(repository.resolveIntegration).toHaveBeenCalledWith("company-a", 7, "view_invoice");
    expect(repository.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ operation: "issue_despatch", resourceType: "despatch", status: "completed" }));
    expect(bodies).toContainEqual(expect.objectContaining({ operation: "issue_despatch",
      payload: { id: guideId, confirmed: true, confirmation_digest: guideDraft.confirmation_digest } }));
    expect(JSON.stringify(bodies)).not.toContain("company-token");
    expect(JSON.stringify(bodies)).not.toContain("gre_client_secret");
    expect(bodies).toContainEqual(expect.objectContaining({ operation: "create_despatch", payload: input }));
    if (category !== "other") {
      expect(input).not.toHaveProperty("vehicle");
      expect(input).not.toHaveProperty("driver");
      const posted = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
      expect(posted).not.toHaveProperty("vehicle");
      expect(posted).not.toHaveProperty("driver");
      expect(posted.vehicle_category).toBe(category);
    }
  });

  it.each([
    { operation: "create_despatch" as const, payload: { ...despatchPayload, idempotency_key: "test", transport_mode: "01" } },
    { operation: "create_despatch" as const, payload: { ...despatchPayload, idempotency_key: "test", weight_kg: "0" } },
    { operation: "issue_despatch" as const, payload: { id: guideId, confirmed: false, confirmation_digest: guideDraft.confirmation_digest } },
    { operation: "issue_despatch" as const, payload: { id: guideId, confirmed: true, confirmation_digest: "wrong" } },
    { operation: "refresh_despatch" as const, payload: { id: "../other-company" } },
  ])("rejects invalid GRE operations before provider %j", async (request) => {
    const cipher = new CredentialCipher(masterKey);
    const repository = { resolveIntegration: vi.fn(async () => ({ tenant: authorizedAccess.tenant,
      encryptedToken: cipher.encrypt("company-token") })), recordAudit: vi.fn(async () => undefined) };
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(), cipher, "https://factura.example", vi.fn());
    expect(await service.process({ ...request, tenant_id: "company-a", contact_id: 7 }, "gre-invalid", "b".repeat(64)))
      .toMatchObject({ response: { ok: false, error: { code: "invalid_request" } } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies unauthorized GRE emission before touching provider", async () => {
    const repository = { resolveIntegration: vi.fn(async () => null) };
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(), new CredentialCipher(masterKey), "https://factura.example", vi.fn());
    expect(await service.process({ tenant_id: "another-company", contact_id: 7, operation: "issue_despatch",
      payload: { id: guideId, confirmed: true, confirmation_digest: guideDraft.confirmation_digest } }, "gre-denied", "b".repeat(64)))
      .toMatchObject({ response: { ok: false, error: { code: "forbidden" } } });
    expect(repository.resolveIntegration).toHaveBeenCalledWith("another-company", 7, "issue_invoice");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  const creditPayload = { documentType: "01", customerDocumentType: "6", customerRuc: "20123456789",
    customerName: "Cliente Demo", issueDate: "2026-11-05", taxMode: "included", productsText: "1 servicio S/ 118",
    paymentMethod: "credito", outstandingAmount: "100.00",
    installments: [{ due_date: "2027-12-05", amount: "60.00" }, { due_date: "2027-12-10", amount: "40.00" }] };

  it("carries credit through signed bridge and multipart once with company permission and replay", async () => {
    const cipher = new CredentialCipher(masterKey);
    const repository = { resolveIntegration: vi.fn(async () => ({ tenant: authorizedAccess.tenant,
      encryptedToken: cipher.encrypt("private-company-token") })), recordAudit: vi.fn(async () => undefined) };
    const forms: FormData[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      forms.push(init!.body as FormData);
      return Response.json({ data: { id: "credit-draft", status: "review_required", payment_method: "credito",
        outstanding_amount: "100.00", installments: creditPayload.installments } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(), cipher,
      "https://facturas.example", vi.fn());
    const bodies: unknown[] = [];
    const bridge = new SignedVpsBridgeClient("https://bridge.example/internal/manolo",
      "a-secure-bridge-secret-with-32-characters", vi.fn(), async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        const requestId = new Headers(init?.headers).get("X-Manolo-Request-Id")!;
        if (body.operation === "resolve_tenant") return Response.json({ request_id: requestId, ok: true, data: authorizedAccess, replayed: false });
        const result = await service.process(body, requestId, "c".repeat(64));
        if (result.status !== "completed") throw new Error("Unexpected conflict");
        return Response.json(result.response);
      });
    const client = new VpsFacturayaClient(bridge, "manolo", 7, "credit-message", vi.fn());
    const input = { ...creditPayload, documentType: "01" as const, customerDocumentType: "6" as const,
      taxMode: "included" as const, paymentMethod: "credito" as const };
    await expect(client.importInvoiceDraft(input)).resolves.toMatchObject({ ok: true,
      data: { payment_method: "credito", outstanding_amount: "100.00", installments: creditPayload.installments } });
    await client.importInvoiceDraft(input);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bodies[1]).toMatchObject({ tenant_id: "company-a", contact_id: 7, payload: creditPayload });
    expect(repository.resolveIntegration).toHaveBeenCalledWith("company-a", 7, "create_invoice");
    expect(forms[0].get("outstanding_amount")).toBe("100.00");
    expect(forms[0].get("installments[1][amount]")).toBe("40.00");
    expect(JSON.stringify(bodies)).not.toContain("private-company-token");
  });

  it.each([
    { paymentMethod: "unknown" }, { documentType: "03" }, { outstandingAmount: "100.001" },
    { outstandingAmount: "0.00" }, { installments: [] },
    { installments: [{ due_date: "2026-02-30", amount: "100.00" }] },
    { installments: [{ due_date: "2026-11-05", amount: "100.00" }] },
    { installments: [{ due_date: "2027-12-05", amount: "99.00" }] },
    { paymentMethod: "contado" },
  ])("rejects invalid payment data at the bridge before API: %j", async (patch) => {
    const cipher = new CredentialCipher(masterKey);
    const repository = { resolveIntegration: vi.fn(async () => ({ tenant: authorizedAccess.tenant,
      encryptedToken: cipher.encrypt("company-token") })), recordAudit: vi.fn(async () => undefined) };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(), cipher,
      "https://facturas.example", vi.fn());
    const result = await service.process({ tenant_id: "company-a", contact_id: 7, operation: "import_invoice_draft",
      payload: { ...creditPayload, ...patch } }, "invalid-credit", "b".repeat(64));
    expect(result).toMatchObject({ status: "completed", response: { ok: false, error: { code: "invalid_request" } } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries DNI through the signed bridge, checks permissions and replays without querying twice", async () => {
    const cipher = new CredentialCipher(masterKey);
    const repository = {
      resolveIntegration: vi.fn(async () => ({ tenant: authorizedAccess.tenant,
        encryptedToken: cipher.encrypt("private-company-token") })),
      recordAudit: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn(async () => Response.json({ data: {
      document_type: "1", ruc: "12345678", name: "CLIENTE PRUEBA" }, meta: { source: "saved" } }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(),
      cipher, "https://facturas.example", vi.fn());
    const bodies: unknown[] = [];
    const bridge = new SignedVpsBridgeClient("https://facturas.example/internal/manolo",
      "a-secure-bridge-secret-with-32-characters", vi.fn(), async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        const requestId = new Headers(init?.headers).get("X-Manolo-Request-Id")!;
        if (body.operation === "resolve_tenant") return Response.json({
          request_id: requestId, ok: true, data: authorizedAccess, replayed: false });
        const result = await service.process(body, requestId, "a".repeat(64));
        if (result.status !== "completed") throw new Error("Unexpected request conflict");
        return Response.json(result.response);
      });
    const client = new VpsFacturayaClient(bridge, "manolo", 7, "dni-query", vi.fn());
    await expect(client.lookupCustomerByDni("12345678")).resolves.toMatchObject({
      ok: true, data: { name: "CLIENTE PRUEBA" } });
    await client.lookupCustomerByDni("12345678");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bodies[1]).toEqual({ tenant_id: "company-a", contact_id: 7,
      operation: "lookup_customer_dni", payload: { dni: "12345678" } });
    expect(repository.resolveIntegration).toHaveBeenCalledWith("company-a", 7, "create_invoice");
    expect(JSON.stringify(bodies)).not.toContain("private-company-token");
    expect(repository.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ operation: "customer_lookup", status: "completed" }));
  });

  it("denies DNI lookup for an unauthorized company before any API call", async () => {
    const repository = { resolveIntegration: vi.fn(async () => null) };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new FacturayaOperationService(repository as never, new MemoryRequestStore(),
      new CredentialCipher(masterKey), "https://facturas.example", vi.fn());
    expect(await service.process({ tenant_id: "other-company", contact_id: 7,
      operation: "lookup_customer_dni", payload: { dni: "12345678" } }, "denied-dni", "b".repeat(64)))
      .toMatchObject({ response: { ok: false, error: { code: "forbidden" } } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("encrypts each token with authenticated random encryption", () => {
    const cipher = new CredentialCipher(masterKey);
    const first = cipher.encrypt("company-token-secret");
    const second = cipher.encrypt("company-token-secret");

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe("company-token-secret");
    const parts = first.split(":");
    const ciphertext = Buffer.from(parts[3], "base64url");
    ciphertext[0] ^= 1;
    parts[3] = ciphertext.toString("base64url");
    expect(() => cipher.decrypt(parts.join(":"))).toThrow();
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
