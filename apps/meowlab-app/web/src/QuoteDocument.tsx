import type { CSSProperties } from "react";

export type PaymentEntry = { kind: "bank" | "cci" | "yape" | "plin"; label: string; value: string };

/** A company's brand kit (ADR-0012): what goes on all its documents. */
export type BrandKit = {
  primaryColor: string | null;
  contactAddress: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactWeb: string | null;
  paymentMethods: PaymentEntry[];
  footerText: string | null;
  quoteValidDays: number | null;
  quotePaymentTerms: string | null;
  quoteDeliveryTerms: string | null;
};
export type BrandKitView = BrandKit & { logo: { version: string; width: number; height: number } | null; updatedAt: string | null };

export type Quote = {
  company: { name: string; legalName: string | null; ruc: string | null; address: string | null };
  number: number;
  issuedAt: string;
  validUntil: string;
  customerName: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  brand?: BrandKitView;
  lines: Array<{ description: string; quantity: number; unitPriceCents: number; totalCents: number }>;
};

export const PAYMENT_KIND_LABEL: Record<PaymentEntry["kind"], string> = { bank: "Cuenta", cci: "CCI", yape: "Yape", plin: "Plin" };

/** MeowLab's forest green: the color when the company has not chosen one. */
export const DEFAULT_BRAND_COLOR = "#0f3d2e";

const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG contrast of a #rrggbb color against white text; same rule as the bridge. */
export function contrastWithWhite(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 1.05 / (0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) + 0.05);
}

const soles = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const qty = (value: number) => (Number.isInteger(value) ? String(value) : value.toLocaleString("es-PE", { maximumFractionDigits: 3 }));

/**
 * The quote sheet itself, shared by the public page and the brand kit preview so both
 * always look the same. `logoUrl` is null when the company has no logo.
 */
export function QuoteDocument({ quote, brand, logoUrl, expired = false }: {
  quote: Quote;
  brand: BrandKit | null;
  logoUrl: string | null;
  expired?: boolean;
}) {
  const color = brand?.primaryColor ?? DEFAULT_BRAND_COLOR;
  const contact = [brand?.contactPhone, brand?.contactEmail, brand?.contactWeb].filter(Boolean) as string[];
  const address = brand?.contactAddress ?? quote.company.address;
  const terms = [
    quote.paymentTerms ? { label: "Condiciones de pago", text: quote.paymentTerms } : null,
    quote.deliveryTerms ? { label: "Plazo de entrega", text: quote.deliveryTerms } : null,
  ].filter(Boolean) as Array<{ label: string; text: string }>;
  const methods = brand?.paymentMethods ?? [];
  return (
    <div className="@container">
    <article className="overflow-hidden rounded-3xl bg-white shadow-card print:rounded-none print:shadow-none"
      style={{ "--brand": color } as CSSProperties}>
      <header className="flex flex-col gap-5 bg-[var(--brand)] px-6 py-7 text-white @xl:px-10 print:bg-white print:text-ink">
        <div className="flex min-w-0 flex-col items-start gap-4 @md:flex-row">
          {logoUrl && (
            <span className="grid h-16 w-24 shrink-0 place-items-center rounded-xl bg-white p-2 print:p-0">
              <img src={logoUrl} alt={`Logo de ${quote.company.name}`} className="max-h-full max-w-full object-contain" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/80 print:text-ink-muted">Cotización N.° {String(quote.number).padStart(4, "0")}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight @xl:text-3xl">{quote.company.legalName ?? quote.company.name}</h1>
            <p className="mt-1 text-sm text-white/80 print:text-ink-muted">
              {quote.company.ruc ? `RUC ${quote.company.ruc}` : ""}{quote.company.ruc && address ? " · " : ""}{address ?? ""}
            </p>
            {contact.length > 0 && <p className="mt-0.5 text-sm text-white/80 print:text-ink-muted">{contact.join(" · ")}</p>}
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-1 border-t border-white/20 pt-4 text-sm print:border-line">
          <div className="flex gap-2"><dt className="text-white/80 print:text-ink-muted">Fecha</dt><dd className="font-semibold">{date(quote.issuedAt)}</dd></div>
          <div className="flex gap-2"><dt className="text-white/80 print:text-ink-muted">Válida hasta</dt><dd className="font-semibold">{date(quote.validUntil)}</dd></div>
        </dl>
      </header>

      <div className="space-y-6 px-6 py-7 @xl:px-10">
        {expired && (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Esta cotización ya venció. Pide una actualizada a {quote.company.name}.
          </p>
        )}
        <p className="text-ink-2"><span className="text-ink-muted">Para:</span> <strong className="font-semibold text-ink">{quote.customerName}</strong></p>

        <table className="w-full text-sm">
          <caption className="sr-only">Detalle de la cotización</caption>
          <thead className="border-b border-line text-left text-ink-muted">
            <tr>
              <th scope="col" className="py-2 pr-3 font-semibold">Descripción</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Cant.</th>
              <th scope="col" className="hidden py-2 pr-3 text-right font-semibold @xl:table-cell">P. unit.</th>
              <th scope="col" className="py-2 text-right font-semibold">Importe</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line, index) => (
              <tr key={index} className="border-b border-line align-top">
                <td className="py-3 pr-3 text-ink">
                  {line.description}
                  <span className="block text-xs text-ink-muted @xl:hidden">{soles(line.unitPriceCents)} c/u</span>
                </td>
                <td className="py-3 pr-3 text-right tabular-nums text-ink-2">{qty(line.quantity)}</td>
                <td className="hidden py-3 pr-3 text-right tabular-nums text-ink-2 @xl:table-cell">{soles(line.unitPriceCents)}</td>
                <td className="py-3 text-right font-semibold tabular-nums text-ink">{soles(line.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          {quote.discountCents > 0 && (
            <>
              <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular-nums">{soles(quote.subtotalCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Descuento</dt><dd className="tabular-nums">−{soles(quote.discountCents)}</dd></div>
            </>
          )}
          <div className="flex justify-between border-t border-line pt-2 text-lg">
            <dt className="font-bold text-ink">Total</dt><dd className="font-bold tabular-nums text-[var(--brand)]">{soles(quote.totalCents)}</dd>
          </div>
          <p className="text-right text-xs text-ink-muted">Precios en soles, IGV incluido.</p>
        </dl>

        {quote.notes && <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-2">{quote.notes}</p>}

        {(terms.length > 0 || methods.length > 0) && (
          <div className="grid gap-4 border-t border-line pt-5 text-sm @xl:grid-cols-2">
            {terms.length > 0 && (
              <dl className="space-y-2">
                {terms.map((term) => (
                  <div key={term.label}>
                    <dt className="font-semibold text-ink">{term.label}</dt>
                    <dd className="text-ink-2">{term.text}</dd>
                  </div>
                ))}
              </dl>
            )}
            {methods.length > 0 && (
              <div className="space-y-1">
                <h2 className="font-semibold text-ink">Formas de pago</h2>
                <ul className="space-y-0.5 text-ink-2">
                  {methods.map((method, index) => (
                    <li key={index}>
                      <span className="text-ink-muted">{method.label || PAYMENT_KIND_LABEL[method.kind]}:</span>{" "}
                      <span className="tabular-nums">{method.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {brand?.footerText && (
        <footer className="border-t border-line px-6 py-4 text-center text-sm text-ink-muted @xl:px-10">{brand.footerText}</footer>
      )}
    </article>
    </div>
  );
}
