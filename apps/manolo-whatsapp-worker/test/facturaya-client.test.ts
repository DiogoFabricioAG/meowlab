import { afterEach, describe, expect, it, vi } from "vitest";
import { FacturayaApiClient } from "../src/adapters/facturaya/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FacturayaApiClient", () => {
  const draftId = "01K37H3CAX3JJRKRV6HK7Z6R4P";
  it("reads a selected draft with items and credit notes from the authorized detail endpoint", async () => {
    const data = { id: draftId, items: [{ description: "Chalecos", quantity: "25" }], invoice: { credit_notes: [{ status: "accepted" }] } };
    const request = vi.fn(async () => Response.json({ data })); vi.stubGlobal("fetch", request);
    const client = new FacturayaApiClient("https://facturaya.example", "company-token", vi.fn());
    await expect(client.listInvoiceDrafts(undefined, draftId)).resolves.toEqual({ ok: true, data: [data] });
    expect(request).toHaveBeenCalledWith(`https://facturaya.example/api/invoice-drafts/${draftId}`, expect.objectContaining({ method: "GET" }));
    await expect(client.listInvoiceDrafts(undefined, "../other")).resolves.toMatchObject({ ok: false });
    expect(request).toHaveBeenCalledOnce();
  });
  it("serializes credit terms with bracket notation and preserves response terms", async () => {
    const terms = { payment_method: "credito", outstanding_amount: "100.00", currency: "USD",
      installments: [{ due_date: "2027-12-05", amount: "60.00" }, { due_date: "2027-12-10", amount: "40.00" }] };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ data: {
      id: draftId, status: "review_required", ...terms } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient("https://facturaya.example", "company-token", vi.fn());
    await expect(client.importInvoiceDraft({ documentType: "01", customerDocumentType: "6",
      customerRuc: "20123456789", customerName: "Cliente Demo", issueDate: "2026-11-05", taxMode: "included",
      paymentMethod: "credito", outstandingAmount: "100.00", installments: terms.installments,
      productsText: "1 servicio USD 118" })).resolves.toMatchObject({ ok: true, data: terms });
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get("payment_method")).toBe("credito");
    expect(form.get("outstanding_amount")).toBe("100.00");
    expect(form.get("installments[0][due_date]")).toBe("2027-12-05");
    expect(form.get("installments[0][amount]")).toBe("60.00");
    expect(form.get("installments[1][amount]")).toBe("40.00");
  });

  it("sends cash explicitly and omits balance and installments from multipart", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ data: { id: draftId } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient("https://facturaya.example", "company-token", vi.fn());
    await client.importInvoiceDraft({ documentType: "01", customerDocumentType: "6", customerRuc: "20123456789",
      customerName: "Cliente Demo", issueDate: "2026-11-05", taxMode: "included", paymentMethod: "contado",
      outstandingAmount: null, installments: [] });
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get("payment_method")).toBe("contado");
    expect(form.has("outstanding_amount")).toBe(false);
    expect([...form.keys()].some((key) => key.startsWith("installments"))).toBe(false);
  });

  it("uses authenticated DNI lookup and discards verification metadata", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      data: { ruc: "12345678", document_type: "1", name: "CLIENTE PRUEBA" },
      meta: { source: "api_peru_dni", provider: "api_peru_dni", cod_verifica: "secret-detail" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient("https://facturaya.example", "company-token", vi.fn());
    const result = await client.lookupCustomerByDni("12345678");
    expect(result).toEqual({ ok: true, data: { ruc: "12345678", name: "CLIENTE PRUEBA",
      source: "api_peru_dni", provider: "api_peru_dni" } });
    expect(fetchMock).toHaveBeenCalledWith("https://facturaya.example/api/customers/lookup-dni/12345678",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer company-token" }) }));
    await client.lookupCustomerByDni("123456789");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { ruc: "87654321", document_type: "1", name: "OTRO CLIENTE" },
    { ruc: "12345678", document_type: "6", name: "EMPRESA" },
    { ruc: "12345678", document_type: "1", name: " " },
  ])("rejects malformed or mismatched DNI results: %j", async (data) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data })));
    const client = new FacturayaApiClient("https://facturaya.example", "company-token", vi.fn());
    await expect(client.lookupCustomerByDni("12345678")).resolves.toMatchObject({ ok: false, reason: "api_error" });
  });

  it.each([[404, "not_found"], [503, "api_error"], [401, "unauthorized"]] as const)(
    "reports DNI lookup HTTP %s safely", async (status, reason) => {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "unavailable" }, { status })));
      const client = new FacturayaApiClient("https://facturaya.example", "company-token", vi.fn());
      await expect(client.lookupCustomerByDni("12345678")).resolves.toMatchObject({ ok: false, reason });
    });

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
