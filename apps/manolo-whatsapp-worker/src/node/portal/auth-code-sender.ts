import { signBridgePayload } from "../../bridge/signature";
import { AUTH_CODE_WORKER_PATH, type AuthCodeRequest } from "../../bridge/portal-link-contracts";
import type { RoleLog } from "../../roles/contracts";
import type { AuthCodeSender } from "./link-service";

/** Asks the Manolo Worker, which holds the Meta token, to deliver the code. */
export class WorkerAuthCodeSender implements AuthCodeSender {
  constructor(
    private readonly workerBaseUrl: string,
    private readonly secret: string,
    private readonly log: RoleLog,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(to: string, code: string, requestId: string): Promise<boolean> {
    const body = JSON.stringify({ version: 1, requestId, to, code } satisfies AuthCodeRequest);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    try {
      const response = await this.fetchImpl(`${this.workerBaseUrl}${AUTH_CODE_WORKER_PATH}`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "Content-Type": "application/json",
          "X-Manolo-Timestamp": timestamp,
          "X-Manolo-Signature": await signBridgePayload(this.secret, timestamp, body),
          "X-Manolo-Request-Id": requestId,
        },
        body,
      });
      if (!response.ok) this.log("portal_auth_code_worker_rejected", { status: response.status });
      return response.ok;
    } catch {
      this.log("portal_auth_code_worker_unreachable");
      return false;
    }
  }
}
