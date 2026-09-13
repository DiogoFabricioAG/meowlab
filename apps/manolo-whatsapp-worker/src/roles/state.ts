export interface RoleStateRepository {
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
