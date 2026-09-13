import type { DocumentStore, IncomingDocument } from "../../documents/contracts";

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

export class R2DocumentStore implements DocumentStore {
  constructor(private readonly bucket: R2Bucket | null | undefined) {}

  async put(key: string, document: IncomingDocument): Promise<boolean> {
    if (!this.bucket || !key.trim() || document.bytes.byteLength > MAX_DOCUMENT_BYTES) {
      return false;
    }

    try {
      await this.bucket.put(key, document.bytes, {
        httpMetadata: { contentType: document.mimeType },
        customMetadata: { filename: document.filename.slice(0, 255) },
      });
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<IncomingDocument | null> {
    if (!this.bucket || !key.trim()) return null;

    try {
      const object = await this.bucket.get(key);
      if (!object || object.size > MAX_DOCUMENT_BYTES) return null;
      const bytes = new Uint8Array(await object.arrayBuffer());
      return {
        bytes,
        mimeType: object.httpMetadata?.contentType || "application/octet-stream",
        filename: object.customMetadata?.filename || "documento.pdf",
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.bucket || !key.trim()) return false;

    try {
      await this.bucket.delete(key);
      return true;
    } catch {
      return false;
    }
  }
}
