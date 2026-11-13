/**
 * Minimal Mercado Pago client for recurring subscriptions (preapproval) and webhook
 * signature verification. WebCrypto + fetch: runs on Node and on Workers.
 */
const API = "https://api.mercadopago.com";
const PAGE = 12;

export type Preapproval = {
  id: string;
  status: string;
  external_reference: string | null;
  init_point?: string;
  next_payment_date?: string | null;
  auto_recurring?: { transaction_amount?: number; currency_id?: string };
};

export type AuthorizedPayment = {
  id: string | number;
  preapproval_id: string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  debit_date?: string | null;
  date_created?: string;
  payment?: { id?: number | string; status?: string } | null;
};

export interface MercadoPagoApi {
  createPreapproval(input: {
    reason: string;
    externalReference: string;
    payerEmail: string;
    amount: number;
    backUrl: string;
  }): Promise<Preapproval>;
  getPreapproval(id: string): Promise<Preapproval>;
  cancelPreapproval(id: string): Promise<Preapproval>;
  authorizedPayments(preapprovalId: string): Promise<AuthorizedPayment[]>;
  getAuthorizedPayment(id: string): Promise<AuthorizedPayment>;
}

export class MercadoPagoError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`mercadopago_${status}_${code}`);
  }
}

export class MercadoPagoClient implements MercadoPagoApi {
  constructor(
    private readonly accessToken: string,
    // Wrapped: calling a stored `fetch` as a method throws "Illegal invocation" on Workers.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const response = await this.fetchImpl(`${API}${path}`, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const code = typeof (data as { message?: unknown })?.message === "string"
        ? String((data as { message: string }).message).slice(0, 80)
        : "error";
      throw new MercadoPagoError(response.status, code);
    }
    return data as T;
  }

  createPreapproval(input: Parameters<MercadoPagoApi["createPreapproval"]>[0]) {
    return this.request<Preapproval>("POST", "/preapproval", {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.amount,
        currency_id: "PEN",
      },
    }, input.externalReference);
  }

  getPreapproval(id: string) {
    return this.request<Preapproval>("GET", `/preapproval/${encodeURIComponent(id)}`);
  }

  cancelPreapproval(id: string) {
    return this.request<Preapproval>("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });
  }

  /** Every charge of a subscription. The API rejects pages larger than 12, so it walks them. */
  async authorizedPayments(preapprovalId: string) {
    const all: AuthorizedPayment[] = [];
    for (let offset = 0; offset < 1_200; offset += PAGE) {
      const page = await this.request<{ results?: AuthorizedPayment[]; paging?: { total?: number } }>(
        "GET",
        `/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}&limit=${PAGE}&offset=${offset}`,
      );
      const results = page.results ?? [];
      all.push(...results);
      const total = Number(page.paging?.total ?? 0);
      if (results.length < PAGE || all.length >= total) break;
    }
    return all;
  }

  getAuthorizedPayment(id: string) {
    return this.request<AuthorizedPayment>("GET", `/authorized_payments/${encodeURIComponent(id)}`);
  }
}

const encoder = new TextEncoder();

/**
 * Webhook signature (Mercado Pago docs, "sin SDKs"): header `x-signature: ts=…,v1=…`,
 * manifest `id:<data.id lowercased>;request-id:<x-request-id>;ts:<ts>;` (parts whose
 * value is missing are left out), HMAC-SHA256 hex with the webhook secret.
 */
export async function verifyWebhookSignature(input: {
  secret: string;
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
}): Promise<boolean> {
  if (!input.signatureHeader) return false;
  const parts = Object.fromEntries(
    input.signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key.trim(), rest.join("=").trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !/^\d+$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  let manifest = "";
  if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${ts};`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signature = new Uint8Array(new ArrayBuffer(32));
  for (let index = 0; index < 32; index++) signature[index] = Number.parseInt(v1.slice(index * 2, index * 2 + 2), 16);
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(manifest));
}
