export class RoleStateStorageError extends Error {
  constructor(readonly operation: "read" | "compare_and_set") {
    super("Role state storage unavailable");
  }
}

export interface RoleStateRepository {
  getForUpdate?(tenantId: string, contactId: number, roleKey: string): Promise<string | null>;
  compareAndSet?(
    tenantId: string,
    contactId: number,
    roleKey: string,
    expectedStateJson: string | null,
    stateJson: string | null,
  ): Promise<boolean>;
  get(
    tenantId: string,
    contactId: number,
    roleKey: string,
  ): Promise<string | null>;
  set(
    tenantId: string,
    contactId: number,
    roleKey: string,
    stateJson: string,
  ): Promise<boolean>;
  clear(
    tenantId: string,
    contactId: number,
    roleKey: string,
  ): Promise<boolean>;
}
