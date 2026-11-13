import { useEffect, useState } from "react";
import type { Membership } from "./auth-client";
import { agentLogo } from "./agents";

type StockView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    allowNegative: boolean;
    valueCents: number | null;
    items: Array<{ name: string; kind: "product" | "supply"; onHand: number; minQty: number | null; low: boolean; needsCount: boolean;
      avgCostCents: number | null }>;
    moves: Array<{ at: string; kind: "in" | "out" | "count" | "document_out" | "document_in"; name: string; delta: number; balance: number;
      document: string | null }>;
    unmatched: string[];
  };

const soles = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: number) => value.toLocaleString("es-PE", { maximumFractionDigits: 3 });
const MOVE_LABEL: Record<string, string> = {
  in: "Entrada", out: "Salida", count: "Conteo", document_out: "Vendido", document_in: "Devuelto",
};
const when = (iso: string) => new Date(iso).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" });

/**
 * Stock Cat's page (ADR-0014, point 19): stock with what is running low first, the latest
 * moves and the document lines still to link. Costs and value only for the owner.
 */
export function StockPanel({ company, onBack }: { company: Membership; onBack: () => void }) {
  const [view, setView] = useState<StockView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [tab, setTab] = useState<"stock" | "moves">("stock");

  useEffect(() => {
    setState("loading");
    void fetch(`/api/companies/${encodeURIComponent(company.id)}/stock`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return setState("error");
        setView(await response.json() as StockView);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [company.id]);

  const low = view?.enabled ? view.items.filter((item) => item.low || item.needsCount) : [];

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline">
        <span aria-hidden="true">←</span> Tus agentes
      </button>
      <header className="space-y-1">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-ink">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-mint">
            <img src={agentLogo("stock")} alt="" width={40} height={40} className="h-10 w-10 mix-blend-multiply" decoding="async" />
          </span>
          Stock Cat
        </h1>
        <p className="text-lg text-ink-muted">
          {state === "loading" ? "Revisando tu inventario…"
            : state === "error" ? "No pudimos cargar el inventario. Inténtalo otra vez en unos minutos."
            : !view?.enabled ? "Stock Cat no está activo para esta empresa."
            : low.length ? `${low.length} ${low.length === 1 ? "producto necesita" : "productos necesitan"} atención.`
            : "Nada se está acabando."}
        </p>
      </header>

      {view?.enabled && (
        <>
          {view.owner && view.valueCents !== null && (
            <p className="rounded-2xl bg-forest px-5 py-4 text-white">
              <span className="block text-sm text-mint-text">Tu inventario vale, al costo promedio</span>
              <span className="text-2xl font-bold tabular-nums">{soles(view.valueCents)}</span>
            </p>
          )}

          {view.unmatched.length > 0 && (
            <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              <p className="font-semibold">En tus comprobantes hay productos que Stock Cat no reconoce:</p>
              <p className="mt-1">{view.unmatched.join(", ")}</p>
              <p className="mt-1">Dile en el chat a cuál corresponden, por ejemplo: «{view.unmatched[0]} es …». Los descontará al momento.</p>
            </div>
          )}

          <div className="grid w-full grid-cols-2 gap-1 rounded-[12px] bg-surface-subtle p-1 sm:w-fit" role="tablist" aria-label="Vistas de Stock Cat">
            {(["stock", "moves"] as const).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`min-h-11 rounded-[10px] px-4 text-sm font-semibold transition-colors ${tab === key ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"}`}>
                {key === "stock" ? "Stock" : "Movimientos"}
              </button>
            ))}
          </div>

          {tab === "stock" && (view.items.length === 0 ? (
            <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
              Todavía no hay productos. Escríbele a Stock Cat en el chat, por ejemplo: «/stock me llegaron 50 polos a 12».
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line bg-white">
              <table className="w-full text-sm">
                <caption className="sr-only">Stock por producto</caption>
                <thead className="bg-surface-subtle text-left text-ink-2">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Producto</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Hay</th>
                    <th scope="col" className="hidden px-4 py-3 text-right font-semibold sm:table-cell">Mínimo</th>
                    {view.owner && <th scope="col" className="hidden px-4 py-3 text-right font-semibold md:table-cell">Costo prom.</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {view.items.map((item) => (
                    <tr key={item.name} className={item.low || item.needsCount ? "bg-amber-50/60" : undefined}>
                      <td className="px-4 py-3 text-ink">
                        <span className="font-medium">{item.name}</span>
                        {item.kind === "supply" && <span className="chip ml-2 border border-line bg-surface-subtle text-ink-2">Insumo</span>}
                        {item.low && <span className="chip ml-2 border border-amber-300 bg-amber-100 text-amber-900">Se acaba</span>}
                        {item.needsCount && <span className="chip ml-2 border border-amber-300 bg-amber-100 text-amber-900">Contar</span>}
                        <span className="block text-xs text-ink-muted sm:hidden">{item.minQty !== null ? `Mínimo ${qty(item.minQty)}` : "Sin mínimo"}</span>
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${item.onHand < 0 ? "text-red-700" : "text-ink"}`}>{qty(item.onHand)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-ink-2 sm:table-cell">{item.minQty !== null ? qty(item.minQty) : "—"}</td>
                      {view.owner && (
                        <td className="hidden px-4 py-3 text-right tabular-nums text-ink-2 md:table-cell">{item.avgCostCents !== null ? soles(item.avgCostCents) : "—"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {tab === "moves" && (view.moves.length === 0 ? (
            <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">Todavía no hay movimientos.</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
              {view.moves.map((move, index) => (
                <li key={`${move.at}-${index}`} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{move.name}</p>
                    <p className="text-ink-muted">{MOVE_LABEL[move.kind]}{move.document ? ` · ${move.document}` : ""} · {when(move.at)}</p>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className={`font-semibold ${move.delta < 0 ? "text-ink" : "text-forest"}`}>{move.delta > 0 ? "+" : ""}{qty(move.delta)}</p>
                    <p className="text-xs text-ink-muted">quedan {qty(move.balance)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ))}

          <p className="text-sm text-ink-muted">
            Las facturas y boletas que emites con Invoice Cat descuentan el stock solas. Para registrar compras, salidas o conteos,
            escríbele /stock a Manolo.{view.owner ? ` Regla de negativos: ${view.allowNegative ? "se permiten y te aviso" : "no se permiten salidas sin stock"}.` : ""}
          </p>
        </>
      )}
    </div>
  );
}
