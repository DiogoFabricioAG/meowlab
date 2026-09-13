import { afterEach, describe, expect, it, vi } from "vitest";
import { FacturayaApiClient } from "../src/adapters/facturaya/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FacturayaApiClient", () => {
  const draftId = "01K37H3CAX3JJRKRV6HK7Z6R4P";

  it("looks up the company legal name using the authenticated FacturaYa API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { ruc: "20557288016", name: "EMPRESA IDENTIFICADA S.A.C." },
      meta: { source: "api_peru", provider: "api_peru", status: "ACTIVO", condition: "HABIDO", address: "LIMA", ubigeo: "150132" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient(
      "https://facturaya.example",
      "fya_company_token",
      vi.fn(),
    );

    await expect(client.lookupCustomer("20557288016")).resolves.toEqual({
      ok: true,
      data: {
        ruc: "20557288016",
        name: "EMPRESA IDENTIFICADA S.A.C.",
        source: "api_peru",
        provider: "api_peru",
        status: "ACTIVO",
        condition: "HABIDO",
        address: "LIMA",
        ubigeo: "150132",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://facturaya.example/api/customers/lookup/20557288016",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends a company-authenticated multipart draft request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { id: draftId, status: "review_required" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient(
      "https://facturaya.example",
      "fya_company_token",
      vi.fn(),
    );

    const result = await client.importInvoiceDraft({
      documentType: "01",
      customerDocumentType: "6",
      customerRuc: "20123456789",
      customerName: "Cliente Demo",
      issueDate: "2026-08-20",
      taxMode: "included",
      productsText: "1 servicio de impresión a S/ 118",
      document: {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "cotizacion.pdf",
        mimeType: "application/pdf",
      },
    });

    expect(result).toEqual({ ok: true, data: { id: draftId, status: "review_required" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe("https://facturaya.example/api/invoice-drafts/import");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fya_company_token");
    const form = init?.body as FormData;
    expect(form.get("document_type")).toBe("01");
    expect(form.get("customer_document_type")).toBe("6");
    expect(form.get("customer_ruc")).toBe("20123456789");
    expect(form.get("products_text")).toBe("1 servicio de impresión a S/ 118");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("sends the electronic receipt contract with a DNI", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { id: draftId, status: "review_required", document_type: "03" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient(
      "https://facturaya.example",
      "fya_company_token",
      vi.fn(),
    );

    await client.importInvoiceDraft({
      documentType: "03",
      customerDocumentType: "1",
      customerRuc: "12345678",
      customerName: "CLIENTE",
      issueDate: "2026-08-23",
      taxMode: "included",
      productsText: "2 motos a S/ 15600 total",
    });

    const [, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    const form = init?.body as FormData;
    expect(form.get("document_type")).toBe("03");
    expect(form.get("customer_document_type")).toBe("1");
    expect(form.get("customer_ruc")).toBe("12345678");
    expect(form.get("customer_name")).toBe("CLIENTE");
    expect(form.get("tax_mode")).toBe("included");
    expect(form.get("products_text")).toBe("2 motos a S/ 15600 total");
  });

  it("sends an anonymous receipt without customer identification", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { id: draftId, status: "review_required", document_type: "03" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient(
      "https://facturaya.example",
      "fya_company_token",
      vi.fn(),
    );

    await client.importInvoiceDraft({
      documentType: "03",
      customerDocumentType: "0",
      customerRuc: null,
      customerName: null,
      issueDate: "2026-09-02",
      taxMode: "included",
      productsText: "1 accesorio a S/ 50",
    });

    const [, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    const form = init?.body as FormData;
    expect(form.get("document_type")).toBe("03");
    expect(form.get("customer_document_type")).toBe("0");
    expect(form.get("customer_ruc")).toBeNull();
    expect(form.get("customer_name")).toBeNull();
    expect(form.get("products_text")).toBe("1 accesorio a S/ 50");
  });

  it("rejects a successful response without a FacturaYa ULID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { status: "review_required" },
    }), { status: 201, headers: { "Content-Type": "application/json" } })));
    const client = new FacturayaApiClient(
      "https://facturaya.example",
      "fya_company_token",
      vi.fn(),
    );

    await expect(client.importInvoiceDraft({
      documentType: "01",
      customerDocumentType: "6",
      customerRuc: "20123456789",
      customerName: "Cliente Demo",
      issueDate: "2026-08-20",
      taxMode: "included",
      productsText: "1 servicio a S/ 118",
    })).resolves.toEqual({
      ok: false,
      reason: "api_error",
      message: "FacturaYa no devolvió un borrador válido.",
    });
  });

  it("maps an unauthorized company token without leaking it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ message: "El token de empresa no es válido." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )));
    const log = vi.fn();
    const client = new FacturayaApiClient("https://facturaya.example", "secret-token", log);

    const result = await client.listInvoiceDrafts();

    expect(result).toEqual({ ok: false, reason: "unauthorized", message: "El token de empresa no es válido." });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
  });
});
