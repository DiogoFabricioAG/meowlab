import type {
  ContactRoleResolutionRequest,
  ContactRoleResolutionResponse,
} from "../../bridge/contracts";

export interface ContactRoleResolver {
  resolve(
    request: ContactRoleResolutionRequest,
  ): Promise<Pick<ContactRoleResolutionResponse, "roleKey" | "source">>;
}
