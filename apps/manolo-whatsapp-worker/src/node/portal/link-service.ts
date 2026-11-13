import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  PORTAL_LINK_CODE_TTL_SECONDS,
  PORTAL_LINK_MAX_ATTEMPTS,
  PORTAL_LINK_MAX_PER_PHONE_PER_HOUR,
  PORTAL_LINK_MAX_PER_USER_PER_HOUR,
  PORTAL_LINK_RESEND_SECONDS,
  maskWhatsAppPhone,
  normalizeWhatsAppPhone,
  type PortalLinkRequest,
  type PortalLinkResponse,
} from "../../bridge/portal-link-contracts";
import type { RoleLog } from "../../roles/contracts";

export type LinkLimits = {
  ttlSeconds: number;
  resendSeconds: number;
  maxPerPhonePerHour: number;
  maxPerUserPerHour: number;
};

export type StartChallengeResult =
  | { ok: true; knownContact: boolean; expiresAt: Date }
  | { ok: false; retryAfterSeconds: number };

export type VerifyChallengeResult =
  | { status: "linked"; phone: string; linkedAt: Date }
  | { status: "invalid_code"; attemptsLeft: number }
  | { status: "expired" };

/** Persistence of challenges and links. Each method is atomic. */
export interface PortalLinkStore {
  startChallenge(input: {
    challengeId: string;
    portalUserId: string;
    phone: string;
    codeHash: string;
    now: Date;
    limits: LinkLimits;
  }): Promise<StartChallengeResult>;
  markDelivery(challengeId: string, delivery: "sent" | "failed"): Promise<void>;
  verifyChallenge(input: {
    challengeId: string;
    portalUserId: string;
    now: Date;
    maxAttempts: number;
    matches: (codeHash: string) => boolean;
  }): Promise<VerifyChallengeResult>;
  linkFor(portalUserId: string): Promise<{ phone: string; linkedAt: Date } | null>;
  unlink(portalUserId: string): Promise<void>;
}

export interface AuthCodeSender {
  send(to: string, code: string, requestId: string): Promise<boolean>;
}

export const DEFAULT_LINK_LIMITS: LinkLimits = {
  ttlSeconds: PORTAL_LINK_CODE_TTL_SECONDS,
  resendSeconds: PORTAL_LINK_RESEND_SECONDS,
  maxPerPhonePerHour: PORTAL_LINK_MAX_PER_PHONE_PER_HOUR,
  maxPerUserPerHour: PORTAL_LINK_MAX_PER_USER_PER_HOUR,
};

export class PortalLinkService {
  constructor(
    private readonly store: PortalLinkStore,
    private readonly sender: AuthCodeSender,
    private readonly pepper: string,
    private readonly log: RoleLog,
    private readonly now: () => Date = () => new Date(),
    private readonly newCode: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
    private readonly limits: LinkLimits = DEFAULT_LINK_LIMITS,
  ) {}

  async handle(request: PortalLinkRequest): Promise<PortalLinkResponse> {
    switch (request.action) {
      case "start":
        return this.start(request.portalUserId, request.phone, request.requestId);
      case "verify": {
        const result = await this.store.verifyChallenge({
          challengeId: request.challengeId,
          portalUserId: request.portalUserId,
          now: this.now(),
          maxAttempts: PORTAL_LINK_MAX_ATTEMPTS,
          matches: (hash) => safeEqualHex(hash, this.hash(request.challengeId, request.code)),
        });
        if (result.status === "linked") {
          this.log("portal_whatsapp_linked");
          return { status: "linked", maskedPhone: maskWhatsAppPhone(result.phone), linkedAt: result.linkedAt.toISOString() };
        }
        return result;
      }
      case "status": {
        const link = await this.store.linkFor(request.portalUserId);
        return link
          ? { status: "linked", maskedPhone: maskWhatsAppPhone(link.phone), linkedAt: link.linkedAt.toISOString() }
          : { status: "not_linked" };
      }
      case "unlink":
        await this.store.unlink(request.portalUserId);
        this.log("portal_whatsapp_unlinked");
        return { status: "unlinked" };
    }
  }

  private async start(portalUserId: string, rawPhone: string, requestId: string): Promise<PortalLinkResponse> {
    const phone = normalizeWhatsAppPhone(rawPhone);
    if (!phone) return { status: "invalid_phone" };
    const challengeId = randomUUID();
    const code = this.newCode();
    const result = await this.store.startChallenge({
      challengeId,
      portalUserId,
      phone,
      codeHash: this.hash(challengeId, code),
      now: this.now(),
      limits: this.limits,
    });
    if (!result.ok) return { status: "rate_limited", retryAfterSeconds: result.retryAfterSeconds };
    const sent = { status: "code_sent", challengeId, expiresAt: result.expiresAt.toISOString(),
      resendAfterSeconds: this.limits.resendSeconds, maskedPhone: maskWhatsAppPhone(phone) } as const;
    // Unknown numbers get the same answer and nothing is sent: no message cost, no
    // disclosure of who is a MeowLab customer, and the challenge can never verify.
    if (!result.knownContact) return sent;
    const delivered = await this.sender.send(phone, code, requestId).catch(() => false);
    await this.store.markDelivery(challengeId, delivered ? "sent" : "failed");
    if (!delivered) {
      this.log("portal_auth_code_delivery_failed");
      return { status: "delivery_failed" };
    }
    return sent;
  }

  private hash(challengeId: string, code: string): string {
    return createHmac("sha256", this.pepper).update(`${challengeId}:${code}`, "utf8").digest("hex");
  }
}

function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

type QueryClient = {
  query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
  release(): void;
};
export type PortalLinkPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export class PgPortalLinkStore implements PortalLinkStore {
  constructor(private readonly pool: PortalLinkPool) {}

  private async transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect() as QueryClient;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  startChallenge(input: Parameters<PortalLinkStore["startChallenge"]>[0]): Promise<StartChallengeResult> {
    return this.transaction(async (client) => {
      // Phone before user, always: concurrent starts serialise without deadlocks.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-link-phone:' || $1))", [input.phone]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('portal-link-user:' || $1))", [input.portalUserId]);
      const { rows: [usage] } = await client.query<{
        by_phone: string; oldest_phone: Date | null; by_user: string; oldest_user: Date | null;
        last_user: Date | null; known: boolean;
      }>(
        `SELECT
           (SELECT count(*) FROM whatsapp.portal_link_challenges
             WHERE wa_phone = $1 AND created_at > $3::timestamptz - interval '1 hour') AS by_phone,
           (SELECT min(created_at) FROM whatsapp.portal_link_challenges
             WHERE wa_phone = $1 AND created_at > $3::timestamptz - interval '1 hour') AS oldest_phone,
           (SELECT count(*) FROM whatsapp.portal_link_challenges
             WHERE portal_user_id = $2 AND created_at > $3::timestamptz - interval '1 hour') AS by_user,
           (SELECT min(created_at) FROM whatsapp.portal_link_challenges
             WHERE portal_user_id = $2 AND created_at > $3::timestamptz - interval '1 hour') AS oldest_user,
           (SELECT max(created_at) FROM whatsapp.portal_link_challenges WHERE portal_user_id = $2) AS last_user,
           EXISTS (SELECT 1 FROM whatsapp.contacts WHERE whatsapp_user_id = $1) AS known`,
        [input.phone, input.portalUserId, input.now],
      );
      const now = input.now.getTime();
      const waits: number[] = [];
      if (usage.last_user && now - usage.last_user.getTime() < input.limits.resendSeconds * 1_000) {
        waits.push(usage.last_user.getTime() + input.limits.resendSeconds * 1_000 - now);
      }
      if (Number(usage.by_phone) >= input.limits.maxPerPhonePerHour && usage.oldest_phone) {
        waits.push(usage.oldest_phone.getTime() + 3_600_000 - now);
      }
      if (Number(usage.by_user) >= input.limits.maxPerUserPerHour && usage.oldest_user) {
        waits.push(usage.oldest_user.getTime() + 3_600_000 - now);
      }
      if (waits.length) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(Math.max(...waits) / 1_000)) };

      const expiresAt = new Date(now + input.limits.ttlSeconds * 1_000);
      // Only the newest code of an account stays usable.
      await client.query(
        `UPDATE whatsapp.portal_link_challenges SET consumed_at = $2
          WHERE portal_user_id = $1 AND consumed_at IS NULL`,
        [input.portalUserId, input.now],
      );
      await client.query(
        `INSERT INTO whatsapp.portal_link_challenges
           (id, portal_user_id, wa_phone, code_hash, created_at, expires_at, delivery)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.challengeId, input.portalUserId, input.phone, input.codeHash, input.now, expiresAt,
          usage.known ? "pending" : "skipped"],
      );
      return { ok: true, knownContact: usage.known, expiresAt };
    });
  }

  async markDelivery(challengeId: string, delivery: "sent" | "failed"): Promise<void> {
    await this.pool.query(
      "UPDATE whatsapp.portal_link_challenges SET delivery = $2 WHERE id = $1 AND delivery = 'pending'",
      [challengeId, delivery],
    );
  }

  verifyChallenge(input: Parameters<PortalLinkStore["verifyChallenge"]>[0]): Promise<VerifyChallengeResult> {
    return this.transaction(async (client) => {
      const { rows: [challenge] } = await client.query<{
        wa_phone: string; code_hash: string; attempts: number; expires_at: Date; consumed_at: Date | null; delivery: string;
      }>(
        `SELECT wa_phone, code_hash, attempts, expires_at, consumed_at, delivery
           FROM whatsapp.portal_link_challenges
          WHERE id = $1 AND portal_user_id = $2
          FOR UPDATE`,
        [input.challengeId, input.portalUserId],
      );
      if (!challenge || challenge.consumed_at || challenge.delivery !== "sent"
        || challenge.expires_at.getTime() <= input.now.getTime() || challenge.attempts >= input.maxAttempts) {
        return { status: "expired" as const };
      }
      if (!input.matches(challenge.code_hash)) {
        await client.query(
          "UPDATE whatsapp.portal_link_challenges SET attempts = attempts + 1 WHERE id = $1",
          [input.challengeId],
        );
        return { status: "invalid_code" as const, attemptsLeft: Math.max(0, input.maxAttempts - challenge.attempts - 1) };
      }
      await client.query("UPDATE whatsapp.portal_link_challenges SET consumed_at = $2 WHERE id = $1", [input.challengeId, input.now]);
      // A number belongs to one account: proving it from another account moves it.
      await client.query(
        "DELETE FROM whatsapp.portal_whatsapp_links WHERE wa_phone = $1 OR portal_user_id = $2",
        [challenge.wa_phone, input.portalUserId],
      );
      await client.query(
        "INSERT INTO whatsapp.portal_whatsapp_links (portal_user_id, wa_phone, linked_at) VALUES ($1, $2, $3)",
        [input.portalUserId, challenge.wa_phone, input.now],
      );
      return { status: "linked" as const, phone: challenge.wa_phone, linkedAt: input.now };
    });
  }

  async linkFor(portalUserId: string): Promise<{ phone: string; linkedAt: Date } | null> {
    const result = await this.pool.query(
      "SELECT wa_phone, linked_at FROM whatsapp.portal_whatsapp_links WHERE portal_user_id = $1",
      [portalUserId],
    ) as { rows: Array<{ wa_phone: string; linked_at: Date }> };
    const row = result.rows[0];
    return row ? { phone: row.wa_phone, linkedAt: row.linked_at } : null;
  }

  async unlink(portalUserId: string): Promise<void> {
    await this.pool.query("DELETE FROM whatsapp.portal_whatsapp_links WHERE portal_user_id = $1", [portalUserId]);
  }
}
