export type IncomingDocument = {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
};

export interface DocumentStore {
  put(key: string, document: IncomingDocument): Promise<boolean>;
  get(key: string): Promise<IncomingDocument | null>;
  delete(key: string): Promise<boolean>;
}
