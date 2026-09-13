import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignedStoreDesignClient } from "../src/adapters/store-designer/client";

describe("SignedStoreDesignClient approval", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the approval action with an HMAC signature", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      const timestamp = headers.get("X-Store-Timestamp") || "";
      const expected = `sha256=${createHmac("sha256", "shared-secret")
        .update(`${timestamp}.${body}`)
        .digest("hex")}`;

      expect(headers.get("X-Store-Signature")).toBe(expected);
      expect(JSON.parse(body)).toMatchObject({
        action: "approve_design",
        tenantId: "manolo",
        contactId: 7,
        whatsappUserId: "51999999999",
        designId: "design-1",
        accessToken: "token-1",
        version: 2,
      });

      return new Response(JSON.stringify({
        designId: "design-1",
        version: 2,
        status: "approved",
        alreadyApproved: false,
        proposalUrl: "https://tienda.example/?designId=design-1&token=token-1",
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new SignedStoreDesignClient(
      "https://tienda.example/api/internal/store-design",
      "shared-secret",
      () => undefined,
    );
    const result = await client.approve({
      tenantId: "manolo",
      contactId: 7,
      whatsappUserId: "51999999999",
      designId: "design-1",
      accessToken: "token-1",
      version: 2,
    });

    expect(result).toEqual({
      ok: true,
      approval: {
        designId: "design-1",
        version: 2,
        proposalUrl: "https://tienda.example/?designId=design-1&token=token-1",
        alreadyApproved: false,
      },
    });
  });
});
