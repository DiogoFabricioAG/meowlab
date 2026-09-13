import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function decodeMasterKey(value: string): Buffer {
  const normalized = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized.replace(/^base64:/i, ""), "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be exactly 32 bytes encoded as base64 or 64 hexadecimal characters",
    );
  }
  return key;
}

function encodePart(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodePart(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export class CredentialCipher {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    this.key = decodeMasterKey(masterKey);
  }

  encrypt(plaintext: string): string {
    if (!plaintext.trim()) throw new Error("Credential cannot be empty");
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [VERSION, encodePart(iv), encodePart(tag), encodePart(ciphertext)].join(":");
  }

  decrypt(encrypted: string): string {
    const [version, ivValue, tagValue, ciphertextValue, extra] = encrypted.split(":");
    if (
      version !== VERSION
      || !ivValue
      || !tagValue
      || !ciphertextValue
      || extra !== undefined
    ) {
      throw new Error("Unsupported or malformed encrypted credential");
    }
    const iv = decodePart(ivValue);
    const tag = decodePart(tagValue);
    const ciphertext = decodePart(ciphertextValue);
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== AUTH_TAG_BYTES) {
      throw new Error("Malformed encrypted credential");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}
