import { useEffect, useState } from "react";
import type { Membership } from "./auth-client";
import { PageHeader } from "./PageHeader";

type Settings = {
  defaultDueDays: number; remindBeforeDays: number; remindEveryDays: number; maxReminders: number;
  windowStartHour: number; windowEndHour: number; skipSundays: boolean;
  yapePhone: string | null; plinPhone: string | null; bankText: string | null; paymentLink: string | null;
};
type Debt = {
  id: string; customer: string; docNumber: string | null; phone: string | null; balanceCents: number; amountCents: number; dueOn: string;
  daysLate: number; document: string | null; description: string | null; remindersSent: number; escalated: boolean; dueForReminder: boolean;
  source: "sale" | "invoice" | "chat";
};
type CollectionsView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    settings: Settings;
    totalCents: number;
    buckets: { current: number; d1_30: number; d31_60: number; d61: number };
    debts: Debt[];
    pending: Array<{ id: string; customer: string; amountCents: number; method: string; operationNumber: string | null; paidOn: string }>;
    recent: Array<{ customer: string; amountCents: number; method: string; paidOn: string }>;
  };

const soles = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const shortDate = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const METHOD: Record<string, string> = {
  yape: "Yape", plin: "Plin", transferencia: "Transferencia", efectivo: "Efectivo", tarjeta: "Tarjeta", enlace: "Enlace de pago",
  nota_credito: "Nota de crédito", otro: "Otro",
};
const SOURCE: Record<Debt["source"], string> = { sale: "Venta", invoice: "Factura", chat: "Chat" };
const due = (debt: Debt) => (debt.daysLate < 0 ? `Vence ${shortDate(debt.dueOn)}` : debt.daysLate === 0 ? "Vence hoy"
  : `${debt.daysLate} ${debt.daysLate === 1 ? "día" : "días"} de atraso`);
const shownPhone = (phone: string) => phone.replace(/^51(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");

const BUCKETS: Array<[keyof Extract<CollectionsView, { enabled: true }>["buckets"], string]> = [
  ["current", "Al día"], ["d1_30", "1–30 días"], ["d31_60", "31–60 días"], ["d61", "Más de 60"],
];

/**
 * Collections Cat's page (ADR-0015, point 17): what the company is owed by age, each debt with
 * the customer's data, «talk to these customers», what came in and the rules. Only the owner
 * edits the rules; reminders and captures are handled in the chat.
 */
export function CollectionsPanel({ company, onBack }: { company: Membership; onBack: () => void }) {
  const [view, setView] = useState<CollectionsView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [tab, setTab] = useState<"debts" | "paid" | "rules">("debts");

  useEffect(() => {
    setState("loading");
    void fetch(`/api/companies/${encodeURIComponent(company.id)}/collections`, { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return setState("error");
        setView(await response.json() as CollectionsView);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [company.id]);

  const escalated = view?.enabled ? view.debts.filter((debt) => debt.escalated) : [];
  const late = view?.enabled ? view.debts.filter((debt) => debt.daysLate > 0).length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        onBack={onBack}
        agent="collections"
        title="Collections Cat"
        subtitle={
          state === "loading" ? "Revisando lo que te deben…"
            : state === "error" ? "No pudimos cargar tus cobranzas. Inténtalo otra vez en unos minutos."
            : !view?.enabled ? "Collections Cat no está activo para esta empresa."
            : !view.totalCents ? "Nadie te debe nada."
            : late ? `${late} ${late === 1 ? "deuda vencida" : "deudas vencidas"}.` : "Todo al día."
        }
      />

      {view?.enabled && (
        <>
          <div className="rounded-2xl bg-forest px-5 py-4 text-white">
            <span className="block text-sm text-mint-text">Te deben</span>
            <span className="text-2xl font-bold tabular-nums">{soles(view.totalCents)}</span>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {BUCKETS.map(([key, label]) => (
                <div key={key} className="rounded-xl bg-white/10 px-3 py-2">
                  <dt className="text-mint-text">{label}</dt>
                  <dd className="font-semibold tabular-nums">{soles(view.buckets[key])}</dd>
                </div>
              ))}
            </dl>
          </div>

          {escalated.length > 0 && (
            <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              <h2 className="font-semibold">Intenta hablar con estos clientes</h2>
              <p className="mt-1">Ya no respondieron a los recordatorios o pidieron que no les escribamos. Collections Cat no hará más con ellos hasta que tú decidas.</p>
              <ul className="mt-2 space-y-1">
                {escalated.map((debt) => (
                  <li key={debt.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span><span className="font-semibold">{debt.customer}</span> · {soles(debt.balanceCents)} · {due(debt)}</span>
                    {debt.phone && (
                      <a href={`https://wa.me/${debt.phone}`} target="_blank" rel="noreferrer" className="font-semibold text-forest underline underline-offset-4">
                        Escribirle ({shownPhone(debt.phone)})
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view.pending.length > 0 && (
            <p role="status" className="rounded-2xl bg-surface-subtle px-5 py-4 text-sm text-ink-2">
              {view.pending.length === 1 ? "Hay 1 captura de pago" : `Hay ${view.pending.length} capturas de pago`} por validar
              ({view.pending.map((payment) => `${payment.customer}, ${soles(payment.amountCents)}`).join("; ")}).
              Escribe /collections en el chat para validarlas.
            </p>
          )}

          <div className="grid w-full grid-cols-3 gap-1 rounded-[12px] bg-surface-subtle p-1 sm:w-fit" role="tablist" aria-label="Vistas de Collections Cat">
            {(["debts", "paid", "rules"] as const).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`min-h-11 rounded-[10px] px-4 text-sm font-semibold transition-colors ${tab === key ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"}`}>
                {key === "debts" ? "Deudas" : key === "paid" ? "Cobrado" : "Reglas"}
              </button>
            ))}
          </div>

          {tab === "debts" && (view.debts.length === 0 ? (
            <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
              No hay deudas. Las ventas al crédito y las facturas a crédito entran solas; también puedes decirle en el chat: «/collections Juan me debe 200».
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line bg-white">
              <table className="w-full text-sm">
                <caption className="sr-only">Deudas por cobrar</caption>
                <thead className="bg-surface-subtle text-left text-ink-2">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Cliente</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Debe</th>
                    <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">Vence</th>
                    <th scope="col" className="hidden px-4 py-3 text-right font-semibold md:table-cell">Recordatorios</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {view.debts.map((debt) => (
                    <tr key={debt.id} className={debt.escalated ? "bg-amber-50/60" : undefined}>
                      <td className="px-4 py-3 text-ink">
                        <span className="font-medium">{debt.customer}</span>
                        <span className="chip ml-2 border border-line bg-surface-subtle text-ink-2">{SOURCE[debt.source]}</span>
                        {debt.dueForReminder && <span className="chip ml-2 border border-mint bg-mint text-forest">Toca recordar</span>}
                        <span className="block text-xs text-ink-muted">
                          {[debt.docNumber ? `${debt.docNumber.length === 11 ? "RUC" : "DNI"} ${debt.docNumber}` : "", debt.phone ? shownPhone(debt.phone) : "Sin WhatsApp",
                            debt.document ?? debt.description ?? ""].filter(Boolean).join(" · ")}
                        </span>
                        <span className="block text-xs text-ink-muted sm:hidden">{due(debt)}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">
                        {soles(debt.balanceCents)}
                        {debt.balanceCents < debt.amountCents && <span className="block text-xs font-normal text-ink-muted">de {soles(debt.amountCents)}</span>}
                      </td>
                      <td className={`hidden px-4 py-3 sm:table-cell ${debt.daysLate > 0 ? "text-red-700" : "text-ink-2"}`}>{due(debt)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums text-ink-2 md:table-cell">{debt.remindersSent} de {view.settings.maxReminders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {tab === "paid" && (view.recent.length === 0 ? (
            <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">Todavía no hay pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
              {view.recent.map((payment, index) => (
                <li key={`${payment.paidOn}-${index}`} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{payment.customer}</p>
                    <p className="text-ink-muted">{METHOD[payment.method] ?? payment.method} · {shortDate(payment.paidOn)}</p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-forest">+{soles(payment.amountCents)}</p>
                </li>
              ))}
            </ul>
          ))}

          {tab === "rules" && (
            <RulesForm company={company} owner={view.owner} settings={view.settings}
              onSaved={(next) => setView(next)} />
          )}

          <p className="text-sm text-ink-muted">
            Para cobrarle a alguien, registrar un pago o validar una captura, escríbele /collections a MeowLab.
            Mientras tu empresa no tenga su propio número de WhatsApp, Collections Cat te prepara cada recordatorio y tú lo envías con un toque.
          </p>
        </>
      )}
    </div>
  );
}

const FIELD = "mt-1 block min-h-11 w-full rounded-[10px] border border-line bg-white px-3 text-ink focus:border-forest focus:outline-none disabled:bg-surface-subtle";

function RulesForm({ company, owner, settings, onSaved }: { company: Membership; owner: boolean; settings: Settings; onSaved: (view: CollectionsView) => void }) {
  const [form, setForm] = useState(() => ({
    yapePhone: settings.yapePhone ?? "", plinPhone: settings.plinPhone ?? "", bankText: settings.bankText ?? "", paymentLink: settings.paymentLink ?? "",
    defaultDueDays: String(settings.defaultDueDays), remindBeforeDays: String(settings.remindBeforeDays), remindEveryDays: String(settings.remindEveryDays),
    maxReminders: String(settings.maxReminders), windowStartHour: String(settings.windowStartHour), windowEndHour: String(settings.windowEndHour),
    skipSundays: settings.skipSundays,
  }));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "invalid" | "error">("idle");

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setStatus("idle");
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const text = (value: string) => (value.trim() ? value.trim() : null);
    const wallet = (value: string) => (value.replace(/\D/g, "") ? value.replace(/\D/g, "").replace(/^51(?=\d{9}$)/, "") : null);
    const next: Settings = {
      yapePhone: wallet(form.yapePhone), plinPhone: wallet(form.plinPhone), bankText: text(form.bankText), paymentLink: text(form.paymentLink),
      defaultDueDays: Number(form.defaultDueDays), remindBeforeDays: Number(form.remindBeforeDays), remindEveryDays: Number(form.remindEveryDays),
      maxReminders: Number(form.maxReminders), windowStartHour: Number(form.windowStartHour), windowEndHour: Number(form.windowEndHour),
      skipSundays: form.skipSundays,
    };
    const change = Object.fromEntries(Object.entries(next).filter(([key, value]) => settings[key as keyof Settings] !== value));
    if (!Object.keys(change).length) return setStatus("saved");
    setStatus("saving");
    const response = await fetch(`/api/companies/${encodeURIComponent(company.id)}/collections/settings`, {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ change }),
    }).catch(() => null);
    if (!response) return setStatus("error");
    if (response.status === 400) return setStatus("invalid");
    if (!response.ok) return setStatus("error");
    onSaved(await response.json() as CollectionsView);
    setStatus("saved");
  }

  const number = (key: keyof typeof form, label: string, min: number, max: number, suffix: string) => (
    <label className="block text-sm font-medium text-ink-2">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input type="number" inputMode="numeric" min={min} max={max} value={String(form[key])} onChange={set(key)} disabled={!owner}
          className={FIELD.replace("mt-1 ", "").replace("w-full", "w-24")} />
        <span className="text-ink-muted">{suffix}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-6 rounded-2xl border border-line bg-white px-5 py-5">
      {!owner && <p className="text-sm text-ink-muted">Solo la titular de la empresa puede cambiar estas reglas.</p>}
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">Cómo te pagan</legend>
        <p className="text-sm text-ink-muted">Collections Cat las ofrece en cada recordatorio.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-ink-2">Yape
            <input inputMode="tel" placeholder="987 654 321" value={form.yapePhone} onChange={set("yapePhone")} disabled={!owner} className={FIELD} />
          </label>
          <label className="block text-sm font-medium text-ink-2">Plin
            <input inputMode="tel" placeholder="987 654 321" value={form.plinPhone} onChange={set("plinPhone")} disabled={!owner} className={FIELD} />
          </label>
          <label className="block text-sm font-medium text-ink-2 sm:col-span-2">Cuenta para transferencias
            <input placeholder="BCP 191-1234567-0-12 · CCI 002-191-001234567012-55" maxLength={300} value={form.bankText} onChange={set("bankText")} disabled={!owner} className={FIELD} />
          </label>
          <label className="block text-sm font-medium text-ink-2 sm:col-span-2">Enlace de pago (Mercado Pago, Culqi, Izipay…)
            <input type="url" placeholder="https://" maxLength={500} value={form.paymentLink} onChange={set("paymentLink")} disabled={!owner} className={FIELD} />
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">Cuándo recuerda</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {number("defaultDueDays", "Plazo si la deuda no trae fecha", 0, 365, "días")}
          {number("remindBeforeDays", "Primer aviso antes de vencer", 0, 30, "días antes")}
          {number("remindEveryDays", "Después de vencer, cada", 1, 60, "días")}
          {number("maxReminders", "Recordatorios como máximo", 1, 20, "por deuda")}
          {number("windowStartHour", "Desde las", 0, 23, ":00")}
          {number("windowEndHour", "Hasta las", 1, 24, ":00")}
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2">
          <input type="checkbox" checked={form.skipSundays} onChange={set("skipSundays")} disabled={!owner} className="h-5 w-5 accent-forest" />
          No escribir los domingos
        </label>
      </fieldset>
      {owner && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={status === "saving"}
            className="min-h-11 rounded-[10px] bg-forest px-5 text-sm font-semibold text-white hover:bg-forest/90 disabled:opacity-60">
            {status === "saving" ? "Guardando…" : "Guardar reglas"}
          </button>
          <p role="status" className="text-sm text-ink-muted">
            {status === "saved" ? "Guardado." : status === "invalid" ? "Revisa los datos: los números de Yape y Plin tienen 9 dígitos, el enlace empieza con https:// y el horario debe terminar después de empezar."
              : status === "error" ? "No pudimos guardar. Inténtalo otra vez." : ""}
          </p>
        </div>
      )}
    </form>
  );
}
