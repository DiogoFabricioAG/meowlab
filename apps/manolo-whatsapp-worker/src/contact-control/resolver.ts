import type { ContactRoleResolutionResponse } from "../bridge/contracts";
import type { RoleLog } from "../roles/contracts";

export type EffectiveRoleResolution = {
  roleKey: string;
  source: "vps" | "d1" | "tenant";
};

type EffectiveRoleResolverOptions = {
  tenantRoleKey: string;
  allowedRoleKeys: readonly string[];
  d1Lookup: () => Promise<string | null>;
  vpsLookup?: () => Promise<ContactRoleResolutionResponse | null>;
  log: RoleLog;
};

export async function resolveEffectiveRole(
  options: EffectiveRoleResolverOptions,
): Promise<EffectiveRoleResolution> {
  const [d1Result, vpsResult] = await Promise.allSettled([
    options.d1Lookup(),
    options.vpsLookup?.() ?? Promise.resolve(null),
  ]);
  const allowedRoles = new Set(options.allowedRoleKeys);
  const vpsRole = vpsResult.status === "fulfilled"
    ? vpsResult.value?.roleKey?.trim() || null
    : null;

  if (vpsRole && allowedRoles.has(vpsRole)) {
    options.log("whatsapp_contact_role_resolved", {
      source: "vps",
      role: vpsRole,
    });
    return { roleKey: vpsRole, source: "vps" };
  }
  if (vpsRole) {
    options.log("whatsapp_contact_role_lookup_failed", {
      source: "vps",
      reason: "unknown_role",
    });
  } else if (options.vpsLookup) {
    options.log("whatsapp_contact_role_fallback_activated", {
      source: "d1",
    });
  }

  const d1Role = d1Result.status === "fulfilled"
    ? d1Result.value?.trim() || null
    : null;
  if (d1Role && allowedRoles.has(d1Role)) {
    return { roleKey: d1Role, source: "d1" };
  }

  return { roleKey: options.tenantRoleKey, source: "tenant" };
}
