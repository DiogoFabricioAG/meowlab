import { useEffect, useState } from "react";
import { QuoteDocument, type Quote } from "./QuoteDocument";

export function quoteCodeFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/cotizacion\/([A-Za-z0-9_-]{22})\/?$/);
  return match ? match[1] : null;
}

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
      <main className="grid min-h-dvh place-items-center bg-white px-4">
        <div className="max-w-md space-y-2 rounded-3xl border border-line bg-white p-8 text-center shadow-card" aria-busy={state === "loading"}>
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
    <div className="min-h-dvh bg-white">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12 print:p-0">
        <QuoteDocument quote={quote} brand={quote.brand ?? null} expired={expired}
          logoUrl={quote.brand?.logo ? `/api/public/quotes/${code}/logo?v=${quote.brand.logo.version}` : null} />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <button type="button" onClick={() => window.print()} className="btn-primary min-h-11">Imprimir o guardar en PDF</button>
          <p className="text-sm text-ink-muted">Preparada con Sales Cat de MeowLab</p>
        </div>
      </main>
    </div>
  );
}
