const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalBridgePayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

export async function signBridgePayload(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalBridgePayload(timestamp, body)),
  );
  return `sha256=${bytesToHex(signature)}`;
}
