import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalBridgePayload } from "../../bridge/signature";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export type BridgeSignatureVerification =
  | { valid: true }
  | {
      valid: false;
      reason: "missing_headers" | "invalid_timestamp" | "expired" | "invalid_signature";
    };

export function verifyBridgeSignature(
  body: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): BridgeSignatureVerification {
  if (!timestampHeader || !signatureHeader) {
    return { valid: false, reason: "missing_headers" };
  }
  if (!/^\d{10,}$/.test(timestampHeader)) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp)) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return { valid: false, reason: "expired" };
  }

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return { valid: false, reason: "invalid_signature" };

  const provided = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret)
    .update(canonicalBridgePayload(timestampHeader, body), "utf8")
    .digest();
  return timingSafeEqual(provided, expected)
    ? { valid: true }
    : { valid: false, reason: "invalid_signature" };
}
