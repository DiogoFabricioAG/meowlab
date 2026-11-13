import type { TenantContext } from "../../roles/contracts";

// Same provider as outgoing RADAR summaries; no dependence on the tenant's
// inherited fiscal/default model. Only composition knows provider settings.
export function applyRadarAiConfig(tenant: TenantContext, env: Env): void {
  if (tenant.roleKey !== "radar") return;
  tenant.aiProvider = env.ENTERPRISE_AI_PROVIDER?.trim() || "openai";
  tenant.aiModel = env.ENTERPRISE_AI_MODEL?.trim() || "gpt-6-luna";
  tenant.aiReasoningEffort = "low";
  tenant.maxTokens = 1600;
}
