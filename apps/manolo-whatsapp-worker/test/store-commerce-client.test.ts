import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignedStoreCommerceClient } from "../src/adapters/store-designer/commerce-client";

describe("SignedStoreCommerceClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the signed catalog and creates a draft without accepting a price", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      const timestamp = headers.get("X-Store-Timestamp") || "";
      expect(headers.get("X-Store-Signature")).toBe(
        `sha256=${createHmac("sha256", "shared-secret")
          .update(`${timestamp}.${body}`)
          .digest("hex")}`,
      );
      const parsed = JSON.parse(body) as { action?: string };
      if (parsed.action === "get_catalog") {
        return new Response(JSON.stringify({
          variants: [{
            id: "variant-1",
            tenantId: "default",
            productType: "polo",
            productName: "Polo",
            color: "negro",
            colorName: "Negro",
            size: "M",
            sizeName: "M",
            unitPrice: 50000,
            currencyId: "COP",
            availableQuantity: 10,
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        orderId: "order-1",
        status: "draft",
        designId: "design-1",
        designVersion: 1,
        variantId: "variant-1",
        productType: "polo",
        productName: "Polo",
        color: "Negro",
        size: "M",
        quantity: 2,
        unitPrice: 50000,
        totalAmount: 100000,
        currencyId: "COP",
        alreadyExisting: false,
        confirmedAt: null,
      }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new SignedStoreCommerceClient(
      "https://tienda.example/api/internal/store-design",
      "shared-secret",
      () => undefined,
    );
    const reference = {
      tenantId: "manolo",
      contactId: 7,
      whatsappUserId: "51999999999",
      designId: "design-1",
      accessToken: "token-1",
      version: 1,
    };

    const catalog = await client.getCatalog(reference);
    const order = await client.createDraftOrder({
      ...reference,
      variantId: "variant-1",
      quantity: 2,
      idempotencyKey: "config-1:variant-1:2",
    });

    expect(catalog.ok).toBe(true);
    expect(order).toMatchObject({
      ok: true,
      order: {
        orderId: "order-1",
        totalAmount: 100000,
        unitPrice: 50000,
      },
    });
    const draftBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(draftBody.price).toBeUndefined();
    expect(draftBody.unitPrice).toBeUndefined();
  });
});
