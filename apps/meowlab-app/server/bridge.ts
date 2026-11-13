/**
 * Signed client for the Manolo bridge (VPS). Same scheme as Worker → VPS: HMAC-SHA256
 * over `${timestamp}.${body}`, with the portal's own secret, valid only for the
 * portal route. Uses WebCrypto, so it runs on Cloudflare and on Node alike.
 */
export const PORTAL_LINK_BRIDGE_PATH = "/v1/portal/whatsapp-link";

export type PortalLinkResponse =
  | { status: "code_sent"; challengeId: string; expiresAt: string; resendAfterSeconds: number; maskedPhone: string }
  | { status: "invalid_phone" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "delivery_failed" }
  | { status: "linked"; maskedPhone: string; linkedAt: string }
  | { status: "invalid_code"; attemptsLeft: number }
  | { status: "expired" }
  | { status: "not_linked" }
  | { status: "unlinked" };

export type PortalLinkAction =
  | { action: "start"; phone: string }
  | { action: "verify"; challengeId: string; code: string }
  | { action: "status" }
  | { action: "unlink" };

export interface PortalBridge {
  link(portalUserId: string, request: PortalLinkAction): Promise<PortalLinkResponse | null>;
}

const encoder = new TextEncoder();

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return `sha256=${[...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export class SignedPortalBridge implements PortalBridge {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    // Wrapped: calling a stored `fetch` as a method throws "Illegal invocation" on Workers.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async link(portalUserId: string, request: PortalLinkAction): Promise<PortalLinkResponse | null> {
    const requestId = crypto.randomUUID();
    const body = JSON.stringify({ version: 1, requestId, portalUserId, ...request });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${PORTAL_LINK_BRIDGE_PATH}`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          "X-Manolo-Timestamp": timestamp,
          "X-Manolo-Signature": await sign(this.secret, timestamp, body),
          "X-Manolo-Request-Id": requestId,
        },
        body,
      });
      if (!response.ok) return null;
      return (await response.json()) as PortalLinkResponse;
    } catch {
      return null;
    }
  }
}

export function createPortalBridge(url: string | undefined, secret: string | undefined): PortalBridge | null {
  const baseUrl = url?.trim().replace(/\/$/, "");
  const key = secret?.trim();
  if (!baseUrl || !key || key.length < 32) return null;
  return new SignedPortalBridge(baseUrl, key);
}
