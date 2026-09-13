import { describe, expect, it } from "vitest";
import { CAT_ROLE_KEY, CAT_SYSTEM_PROMPT, CatRoleHandler } from "../src/roles/cat-role";
import type { RoleHandler, TenantContext } from "../src/roles/contracts";
import { RoleRegistry, roleRegistry } from "../src/roles/registry";
import { STORE_DESIGNER_ROLE_KEY } from "../src/roles/store-designer-role";
import { ENTERPRISE_ADVISOR_ROLE_KEY } from "../src/roles/enterprise-advisor-role";

const baseTenant: TenantContext = {
  tenantId: "test-tenant",
  phoneNumberId: "test-phone",
  roleKey: "custom",
  systemPrompt: "Custom prompt",
  aiProvider: "groq",
  aiModel: "test-model",
  temperature: 0.5,
  maxTokens: 180,
};

describe("role registry", () => {
  it("applies the cat role configuration", () => {
    const configured = roleRegistry.apply(baseTenant, CAT_ROLE_KEY);

    expect(configured.roleKey).toBe(CAT_ROLE_KEY);
    expect(configured.systemPrompt).toBe(CAT_SYSTEM_PROMPT);
    expect(configured.temperature).toBe(0.8);
  });

  it("keeps the tenant configuration for an unknown role override", () => {
    expect(roleRegistry.apply(baseTenant, "not-registered")).toEqual(baseTenant);
  });

  it("uses cat as the safe fallback handler", () => {
    expect(roleRegistry.resolve("not-registered")).toBeInstanceOf(CatRoleHandler);
  });

  it("rejects duplicate role keys", () => {
    const first = new CatRoleHandler();
    const duplicate: RoleHandler = {
      key: first.key,
      configure: (tenant) => tenant,
      handle: async () => undefined,
    };

    expect(() => new RoleRegistry([first, duplicate], CAT_ROLE_KEY)).toThrow(
      "Duplicate role handler",
    );
  });

  it("registers store-designer as a first-class handler", () => {
    expect(roleRegistry.keys()).toContain(STORE_DESIGNER_ROLE_KEY);
  });

  it("registers enterprise-advisor as a first-class handler", () => {
    expect(roleRegistry.keys()).toContain(ENTERPRISE_ADVISOR_ROLE_KEY);
    const configured = roleRegistry.apply(baseTenant, ENTERPRISE_ADVISOR_ROLE_KEY);
    expect(configured.roleKey).toBe(ENTERPRISE_ADVISOR_ROLE_KEY);
    expect(configured.systemPrompt).toContain("comprobantes electrónicos");
    expect(configured.temperature).toBe(0.2);
  });
});
