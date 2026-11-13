import { useEffect, useState } from "react";

type Quote = {
  company: { name: string; legalName: string | null; ruc: string | null; address: string | null };
  number: number;
  issuedAt: string;
  validUntil: string;
  customerName: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  lines: Array<{ description: string; quantity: number; unitPriceCents: number; totalCents: number }>;
};

export function quoteCodeFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/cotizacion\/([A-Za-z0-9_-]{22})\/?$/);
  return match ? match[1] : null;
}

const soles = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const qty = (value: number) => (Number.isInteger(value) ? String(value) : value.toLocaleString("es-PE", { maximumFractionDigits: 3 }));

/** A quote as the business's customer sees it: no account, printable (ADR-0011). */
export function QuotePage({ code }: { code: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    document.title = "Cotización · MeowLab";
    void fetch(`/api/public/quotes/${code}`)
      .then(async (response) => {
        if (response.status === 404) return setState("missing");
        if (!response.ok) return setState("error");
        setQuote(await response.json() as Quote);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [code]);

  if (state !== "ok" || !quote) {
    return (
      <main className="grid min-h-dvh place-items-center bg-mint-light px-4">
        <div className="max-w-md space-y-2 rounded-3xl bg-white p-8 text-center shadow-card" aria-busy={state === "loading"}>
          <h1 className="text-2xl font-bold text-ink">
            {state === "loading" ? "Abriendo la cotización…" : state === "missing" ? "Esta cotización no existe" : "No pudimos abrir la cotización"}
          </h1>
          {state === "missing" && <p className="text-ink-muted">Puede que el enlace esté incompleto o que la hayan anulado. Pide uno nuevo a quien te la envió.</p>}
          {state === "error" && <p className="text-ink-muted">Inténtalo otra vez en unos minutos.</p>}
        </div>
      </main>
    );
  }

  const expired = new Date(`${quote.validUntil}T23:59:59-05:00`).getTime() < Date.now();
  return (
    <div className="min-h-dvh bg-mint-light print:bg-white">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12 print:p-0">
        <article className="overflow-hidden rounded-3xl bg-white shadow-card print:rounded-none print:shadow-none">
          <header className="flex flex-col gap-4 bg-forest px-6 py-7 text-white sm:flex-row sm:items-start sm:justify-between sm:px-10 print:bg-white print:text-ink">
            <div>
              <p className="text-sm font-semibold text-mint print:text-ink-muted">Cotización N.° {String(quote.number).padStart(4, "0")}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{quote.company.legalName ?? quote.company.name}</h1>
              <p className="mt-1 text-sm text-mint-text print:text-ink-muted">
                {quote.company.ruc ? `RUC ${quote.company.ruc}` : ""}{quote.company.ruc && quote.company.address ? " · " : ""}{quote.company.address ?? ""}
              </p>
            </div>
            <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
              <dt className="text-mint print:text-ink-muted">Fecha</dt><dd>{date(quote.issuedAt)}</dd>
              <dt className="text-mint print:text-ink-muted">Válida hasta</dt><dd>{date(quote.validUntil)}</dd>
            </dl>
          </header>

          <div className="space-y-6 px-6 py-7 sm:px-10">
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
                  <th scope="col" className="hidden py-2 pr-3 text-right font-semibold sm:table-cell">P. unit.</th>
                  <th scope="col" className="py-2 text-right font-semibold">Importe</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((line, index) => (
                  <tr key={index} className="border-b border-line align-top">
                    <td className="py-3 pr-3 text-ink">
                      {line.description}
                      <span className="block text-xs text-ink-muted sm:hidden">{soles(line.unitPriceCents)} c/u</span>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-ink-2">{qty(line.quantity)}</td>
                    <td className="hidden py-3 pr-3 text-right tabular-nums text-ink-2 sm:table-cell">{soles(line.unitPriceCents)}</td>
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
                <dt className="font-bold text-ink">Total</dt><dd className="font-bold tabular-nums text-forest">{soles(quote.totalCents)}</dd>
              </div>
              <p className="text-right text-xs text-ink-muted">Precios en soles, IGV incluido.</p>
            </dl>

            {quote.notes && <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-2">{quote.notes}</p>}
          </div>
        </article>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <button type="button" onClick={() => window.print()} className="btn-primary min-h-11">Imprimir o guardar en PDF</button>
          <p className="text-sm text-ink-muted">Preparada con Sales Cat de MeowLab</p>
        </div>
      </main>
    </div>
  );
}
