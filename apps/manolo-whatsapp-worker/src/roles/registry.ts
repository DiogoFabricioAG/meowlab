import { CatRoleHandler, CAT_ROLE_KEY } from "./cat-role";
import { QuoteRoleHandler } from "./quote-role";
import { PrintAdvisorRoleHandler } from "./print-advisor-role";
import { StoreDesignerRoleHandler } from "./store-designer-role";
import { EnterpriseAdvisorRoleHandler } from "./enterprise-advisor-role";
import type { RoleHandler, TenantContext } from "./contracts";

export class RoleRegistry {
  private readonly handlers: ReadonlyMap<string, RoleHandler>;

  constructor(
    handlers: readonly RoleHandler[],
    private readonly fallbackKey: string,
  ) {
    const handlerMap = new Map<string, RoleHandler>();
    for (const handler of handlers) {
      if (handlerMap.has(handler.key)) {
        throw new Error(`Duplicate role handler: ${handler.key}`);
      }
      handlerMap.set(handler.key, handler);
    }

    if (!handlerMap.has(fallbackKey)) {
      throw new Error(`Missing fallback role handler: ${fallbackKey}`);
    }

    this.handlers = handlerMap;
  }

  resolve(roleKey: string): RoleHandler {
    return this.handlers.get(roleKey) ?? this.handlers.get(this.fallbackKey)!;
  }

  apply(tenant: TenantContext, roleKey: string): TenantContext {
    return this.handlers.get(roleKey)?.configure(tenant) ?? tenant;
  }

  keys(): string[] {
    return [...this.handlers.keys()];
  }
}

export const roleRegistry = new RoleRegistry(
  [
    new CatRoleHandler(),
    new QuoteRoleHandler(),
    new PrintAdvisorRoleHandler(),
    new StoreDesignerRoleHandler(),
    new EnterpriseAdvisorRoleHandler(),
  ],
  CAT_ROLE_KEY,
);
