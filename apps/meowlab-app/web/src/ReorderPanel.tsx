import { useEffect, useState } from "react";
import type { Membership } from "./auth-client";
<<<<<<< HEAD
import { PageHeader } from "./PageHeader";
=======
import { apiFetch } from "./api";
import { agentLogo } from "./agents";
>>>>>>> 6cc3d (feat(app-movil): shell Capacitor Android, apiFetch, bearer auth y CORS)

type Settings = { monthlyBudgetCents: number | null; followupHours: number; escalateHours: number };
type Order = {
  id: string; number: number; kind: "purchase" | "production";
  status: "proposed" | "sent" | "confirmed" | "partial" | "received" | "declined" | "in_production" | "done" | "cancelled";
  supplier: { name: string; phone: string | null; ruc: string | null } | null;
  lines: Array<{ item: string; quantity: number; receivedQty: number; unitPriceCents: number | null }>;
  estimatedCents: number | null; confirmedCents: number | null; deliverBy: string | null; sentAt: string | null;
  approved: boolean; escalated: boolean; supplierNote: string | null;
};
type ReorderView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    settings: Settings;
    proposals: Order[];
    open: Order[];
    notices: Array<{ id: string; kind: string; body: string; createdAt: string }>;
    needsMax: string[];
    needsSupplier: string[];
    monthSpentCents: number;
    suppliers: Array<{ name: string; phone: string | null; ruc: string | null; items: string[] }>;
    month: Array<{ supplier: string; orders: number; totalCents: number }>;
  };

const soles = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const shortDate = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const quantity = (value: number) => (Number.isInteger(value) ? String(value) : value.toLocaleString("es-PE", { maximumFractionDigits: 3 }));
const code = (number: number) => `OC-${String(number).padStart(6, "0")}`;
const shownPhone = (phone: string) => phone.replace(/^51(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
const STATUS: Record<Order["status"], string> = {
  proposed: "Por aprobar", sent: "Esperando al proveedor", confirmed: "Confirmado", partial: "Llegó una parte", received: "Recibido",
  declined: "Rechazado", in_production: "En producción", done: "Terminado", cancelled: "Descartado",
};

function OrderCard({ order }: { order: Order }) {
  const total = order.confirmedCents ?? order.estimatedCents;
  return (
    <li className={`rounded-2xl border bg-white px-4 py-3 text-sm ${order.escalated ? "border-amber-200 bg-amber-50/60" : "border-line"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold text-ink">
          {order.kind === "production" ? "Producir" : order.supplier?.name ?? "Proveedor"}
          <span className="ml-2 font-normal text-ink-muted">{code(order.number)}</span>
        </p>
        <span className="chip border border-line bg-surface-subtle text-ink-2">{STATUS[order.status]}{order.escalated ? " · necesita tu ayuda" : ""}</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-ink-2">
        {order.lines.map((line) => (
          <li key={line.item}>
            {quantity(line.quantity)} × {line.item}
            {line.unitPriceCents !== null && <span className="text-ink-muted"> · {soles(line.unitPriceCents)} c/u</span>}
            {line.receivedQty > 0 && line.receivedQty < line.quantity && <span className="text-ink-muted"> · llegaron {quantity(line.receivedQty)}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-ink-muted">
        {[total !== null && order.kind === "purchase" ? `${order.confirmedCents !== null ? "Total" : "Estimado"} ${soles(total)}` : "",
          order.deliverBy ? `Entrega ${shortDate(order.deliverBy)}` : "", order.supplierNote ? `«${order.supplierNote}»` : ""].filter(Boolean).join(" · ")}
      </p>
    </li>
  );
}

/**
 * Reorder Cat's page (ADR-0016, point 18): what to approve, what is on its way, the suppliers
 * and this month's purchases. Approving happens in the chat, where the order goes out; only
 * the owner changes the budget and the waiting times.
 */
export function ReorderPanel({ company, onBack }: { company: Membership; onBack: () => void }) {
  const [view, setView] = useState<ReorderView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [tab, setTab] = useState<"orders" | "suppliers" | "rules">("orders");

  useEffect(() => {
    setState("loading");
    void apiFetch(`/api/companies/${encodeURIComponent(company.id)}/reorder`)
      .then(async (response) => {
        if (!response.ok) return setState("error");
        setView(await response.json() as ReorderView);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [company.id]);

  const budget = view?.enabled ? view.settings.monthlyBudgetCents : null;

  return (
    <div className="space-y-6">
      <PageHeader
        onBack={onBack}
        agent="reorder"
        title="Reorder Cat"
        subtitle={
          state === "loading" ? "Revisando tus pedidos…"
            : state === "error" ? "No pudimos cargar tus pedidos. Inténtalo otra vez en unos minutos."
            : !view?.enabled ? "Reorder Cat no está activo para esta empresa."
            : view.proposals.length ? `${view.proposals.length} ${view.proposals.length === 1 ? "pedido por aprobar" : "pedidos por aprobar"}.`
            : view.open.length ? `${view.open.length} ${view.open.length === 1 ? "pedido en curso" : "pedidos en curso"}.`
            : "Nada que pedir por ahora."
        }
      />

      {view?.enabled && (
        <>
          <div className="rounded-2xl bg-forest px-5 py-4 text-white">
            <span className="block text-sm text-mint-text">Compras de este mes</span>
            <span className="text-2xl font-bold tabular-nums">{soles(view.monthSpentCents)}</span>
            {budget ? (
              <>
                <span className="ml-2 text-sm text-mint-text">de {soles(budget)}</span>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Presupuesto usado"
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((view.monthSpentCents / budget) * 100))}>
                  <div className={`h-full rounded-full ${view.monthSpentCents > budget ? "bg-amber-300" : "bg-mint"}`}
                    style={{ width: `${Math.min(100, (view.monthSpentCents / budget) * 100)}%` }} />
                </div>
              </>
            ) : <span className="mt-1 block text-sm text-mint-text">Sin presupuesto mensual.</span>}
          </div>

          {view.notices.length > 0 && (
            <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              <h2 className="font-semibold">Novedades de tus proveedores</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {view.notices.map((notice) => <li key={notice.id}>{notice.body}</li>)}
              </ul>
            </section>
          )}

          {(view.needsMax.length > 0 || view.needsSupplier.length > 0) && (
            <p role="status" className="rounded-2xl bg-surface-subtle px-5 py-4 text-sm text-ink-2">
              {view.needsMax.length > 0 && <>Se acaban y falta saber hasta cuánto pedir: <strong>{view.needsMax.join(", ")}</strong>. </>}
              {view.needsSupplier.length > 0 && <>Se acaban y no tienen proveedor con WhatsApp: <strong>{view.needsSupplier.join(", ")}</strong>. </>}
              Díselo a Reorder Cat en el chat con /reorder.
            </p>
          )}

          <div className="grid w-full grid-cols-3 gap-1 rounded-[12px] bg-surface-subtle p-1 sm:w-fit" role="tablist" aria-label="Vistas de Reorder Cat">
            {(["orders", "suppliers", "rules"] as const).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`min-h-11 rounded-[10px] px-4 text-sm font-semibold transition-colors ${tab === key ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"}`}>
                {key === "orders" ? "Pedidos" : key === "suppliers" ? "Proveedores" : "Reglas"}
              </button>
            ))}
          </div>

          {tab === "orders" && (
            view.proposals.length === 0 && view.open.length === 0 ? (
              <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
                No hay pedidos. Cuando algo baje de su mínimo en Stock Cat, Reorder Cat te propone el pedido en el chat.
              </p>
            ) : (
              <div className="space-y-5">
                {view.proposals.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="text-base font-semibold text-ink">Por aprobar</h2>
                    <ul className="space-y-2">{view.proposals.map((order) => <OrderCard key={order.id} order={order} />)}</ul>
                    <p className="text-sm text-ink-muted">Apruébalos en el chat con /reorder: desde ahí el pedido sale a tu proveedor.</p>
                  </section>
                )}
                {view.open.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="text-base font-semibold text-ink">En curso</h2>
                    <ul className="space-y-2">{view.open.map((order) => <OrderCard key={order.id} order={order} />)}</ul>
                  </section>
                )}
              </div>
            )
          )}

          {tab === "suppliers" && (
            <div className="space-y-5">
              {view.suppliers.length === 0 ? (
                <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
                  Todavía no hay proveedores. Se anotan solos con las facturas de compra que registras en Stock Cat, o díselos en el chat:
                  «los polos me los vende Textiles Lima, 987654321».
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
                  {view.suppliers.map((supplier) => (
                    <li key={supplier.name} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{supplier.name}</p>
                        <p className="text-ink-muted">{[supplier.ruc ? `RUC ${supplier.ruc}` : "", supplier.items.length ? supplier.items.join(", ") : "Sin productos asignados"]
                          .filter(Boolean).join(" · ")}</p>
                      </div>
                      {supplier.phone
                        ? <a href={`https://wa.me/${supplier.phone}`} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-forest underline underline-offset-4">
                            {shownPhone(supplier.phone)}
                          </a>
                        : <span className="shrink-0 text-ink-muted">Sin WhatsApp</span>}
                    </li>
                  ))}
                </ul>
              )}
              {view.month.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-ink">Compras de este mes por proveedor</h2>
                  <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
                    {view.month.map((row) => (
                      <li key={row.supplier} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                        <span className="text-ink">{row.supplier} <span className="text-ink-muted">· {row.orders} {row.orders === 1 ? "pedido" : "pedidos"}</span></span>
                        <span className="whitespace-nowrap font-semibold tabular-nums text-ink">{soles(row.totalCents)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {tab === "rules" && <RulesForm company={company} owner={view.owner} settings={view.settings} onSaved={(next) => setView(next)} />}

          <p className="text-sm text-ink-muted">
            Reorder Cat le escribe al proveedor desde el número de MeowLab a nombre de tu empresa, le insiste si no responde y
            te avisa solo si no logra cerrar el pedido. Lo que llega lo registras en Stock Cat y se cruza con el pedido.
          </p>
        </>
      )}
    </div>
  );
}

const FIELD = "block min-h-11 rounded-[10px] border border-line bg-white px-3 text-ink focus:border-forest focus:outline-none disabled:bg-surface-subtle";

function RulesForm({ company, owner, settings, onSaved }: { company: Membership; owner: boolean; settings: Settings; onSaved: (view: ReorderView) => void }) {
  const [form, setForm] = useState(() => ({
    budget: settings.monthlyBudgetCents ? String(settings.monthlyBudgetCents / 100) : "",
    followupHours: String(settings.followupHours),
    escalateHours: String(settings.escalateHours),
  }));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "invalid" | "error">("idle");

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setStatus("idle");
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const budget = form.budget.trim() ? Math.round(Number(form.budget.replace(",", ".")) * 100) : null;
    if (budget !== null && !(budget > 0)) return setStatus("invalid");
    const next: Settings = { monthlyBudgetCents: budget, followupHours: Number(form.followupHours), escalateHours: Number(form.escalateHours) };
    const change = Object.fromEntries(Object.entries(next).filter(([key, value]) => settings[key as keyof Settings] !== value));
    if (!Object.keys(change).length) return setStatus("saved");
    setStatus("saving");
    const response = await apiFetch(`/api/companies/${encodeURIComponent(company.id)}/reorder/settings`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change }),
    }).catch(() => null);
    if (!response) return setStatus("error");
    if (response.status === 400) return setStatus("invalid");
    if (!response.ok) return setStatus("error");
    onSaved(await response.json() as ReorderView);
    setStatus("saved");
  }

  return (
    <form onSubmit={save} className="space-y-6 rounded-2xl border border-line bg-white px-5 py-5">
      {!owner && <p className="text-sm text-ink-muted">Solo la titular de la empresa puede cambiar estas reglas.</p>}
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">Presupuesto</legend>
        <label className="block text-sm font-medium text-ink-2">
          Compras al mes como máximo (vacío: sin tope)
          <span className="mt-1 flex items-center gap-2">
            <span className="text-ink-muted">S/</span>
            <input inputMode="decimal" placeholder="3000" value={form.budget} onChange={set("budget")} disabled={!owner} className={`${FIELD} w-32`} />
          </span>
        </label>
        <p className="text-sm text-ink-muted">Si aprobar un pedido pasa este monto, Reorder Cat te pregunta antes.</p>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">Si el proveedor no responde</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink-2">
            Le insiste a las
            <span className="mt-1 flex items-center gap-2">
              <input type="number" inputMode="numeric" min={1} max={168} value={form.followupHours} onChange={set("followupHours")} disabled={!owner} className={`${FIELD} w-24`} />
              <span className="text-ink-muted">horas</span>
            </span>
          </label>
          <label className="block text-sm font-medium text-ink-2">
            Te avisa a las
            <span className="mt-1 flex items-center gap-2">
              <input type="number" inputMode="numeric" min={2} max={336} value={form.escalateHours} onChange={set("escalateHours")} disabled={!owner} className={`${FIELD} w-24`} />
              <span className="text-ink-muted">horas</span>
            </span>
          </label>
        </div>
        <p className="text-sm text-ink-muted">Solo escribe a proveedores entre las 8:00 y las 20:00.</p>
      </fieldset>
      {owner && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={status === "saving"}
            className="min-h-11 rounded-[10px] bg-forest px-5 text-sm font-semibold text-white hover:bg-forest/90 disabled:opacity-60">
            {status === "saving" ? "Guardando…" : "Guardar reglas"}
          </button>
          <p role="status" className="text-sm text-ink-muted">
            {status === "saved" ? "Guardado." : status === "invalid" ? "Revisa los datos: el presupuesto es un monto mayor a cero y el aviso va después de la insistencia."
              : status === "error" ? "No pudimos guardar. Inténtalo otra vez." : ""}
          </p>
        </div>
      )}
    </form>
  );
}
