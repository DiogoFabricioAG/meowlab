import { describe, expect, it, vi } from "vitest";
import { resolveEffectiveRole } from "../src/contact-control/resolver";
import { PgContactRoleResolver } from "../src/node/control/pg-contact-role-resolver";
import type { ContactRoleResolutionRequest } from "../src/bridge/contracts";

const request: ContactRoleResolutionRequest = {
  version: 1,
  requestId: "wamid.contact-role",
  tenantId: "manolo",
  phoneNumberId: "1266091906580349",
  whatsappUserId: "51999999999",
};

describe("contact role control", () => {
  it("prefers a valid VPS role over the D1 fallback", async () => {
    const result = await resolveEffectiveRole({
      tenantRoleKey: "cat",
      allowedRoleKeys: ["cat", "enterprise-advisor"],
      d1Lookup: async () => "cat",
      vpsLookup: async () => ({
        version: 1,
        requestId: request.requestId,
        roleKey: "enterprise-advisor",
        source: "contact",
      }),
      log: vi.fn(),
    });

    expect(result).toEqual({ roleKey: "enterprise-advisor", source: "vps" });
  });

  it("falls back to D1 when the VPS is unavailable", async () => {
    const result = await resolveEffectiveRole({
      tenantRoleKey: "cat",
      allowedRoleKeys: ["cat", "quotes"],
      d1Lookup: async () => "quotes",
      vpsLookup: async () => null,
      log: vi.fn(),
    });

    expect(result).toEqual({ roleKey: "quotes", source: "d1" });
  });

  it("rejects an unknown remote role", async () => {
    const log = vi.fn();
    const result = await resolveEffectiveRole({
      tenantRoleKey: "cat",
      allowedRoleKeys: ["cat"],
      d1Lookup: async () => null,
      vpsLookup: async () => ({
        version: 1,
        requestId: request.requestId,
        roleKey: "not-deployed-yet",
        source: "contact",
      }),
      log,
    });

    expect(result).toEqual({ roleKey: "cat", source: "tenant" });
    expect(log).toHaveBeenCalledWith(
      "whatsapp_contact_role_lookup_failed",
      expect.objectContaining({ reason: "unknown_role" }),
    );
  });

  it("upserts last-seen data and returns the PostgreSQL role", async () => {
    const query = vi.fn(async () => ({
      rows: [{ role_key: "enterprise-advisor", role_source: "contact" }],
    }));
    const resolver = new PgContactRoleResolver({ query } as never);

    await expect(resolver.resolve(request)).resolves.toEqual({
      roleKey: "enterprise-advisor",
      source: "contact",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("last_seen_at"),
      [request.tenantId, request.phoneNumberId, request.whatsappUserId],
    );
  });
});
