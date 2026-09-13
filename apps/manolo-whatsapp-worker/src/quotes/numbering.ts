export type QuoteSequenceScope = {
  id: string;
  tenantId: string;
  name: string;
};

export interface QuoteNumberAllocator {
  getOrCreateScope(
    tenantId: string,
    contactId: number,
  ): Promise<QuoteSequenceScope | null>;
  allocate(scopeId: string): Promise<string | null>;
}
