import { useEffect, useMemo, useState } from "react";
import { fetchJson, postJson, type Membership } from "./auth-client";

type Agent = { key: string; name: string; description: string; priceCents: number; available: boolean };
type Discount = { minAgents: number; percent: number };
type Subscription = {
  status: "creating" | "pending" | "authorized" | "paused" | "cancelled" | "failed";
  agents: string[];
  amountCents: number;
  payerEmail: string;
  paidUntil: string | null;
  nextPaymentAt: string | null;
  active: boolean;
  checkoutUrl: string | null;
};
type Billing = { agents: Agent[]; discounts: Discount[]; testMode?: boolean; subscription: Subscription | null; canManage?: boolean };

const soles = (cents: number) => `S/ ${(cents / 100).toFixed(2)}`;
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" }) : "—";

function discountFor(count: number, discounts: Discount[]) {
  return discounts.filter((tier) => tier.minAgents <= count).reduce((best, tier) => Math.max(best, tier.percent), 0);
}

const STATUS_LABEL: Record<Subscription["status"], string> = {
  creating: "Preparando el pago",
  pending: "Falta autorizar el pago",
  authorized: "Activa",
  paused: "En pausa",
  cancelled: "Cancelada",
  failed: "No se pudo crear",
};

/**
 * The plan of the company chosen in the menu (ADR-0007, per company since 13/11/2026). Each
 * company pays for its own agents; only its owner subscribes or cancels.
 */
export function PlanPanel({ email, company }: { email: string; company: Membership }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [selected, setSelected] = useState<string[]>(["invoice"]);
  const [payerEmail, setPayerEmail] = useState(email);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const companyQuery = `company=${encodeURIComponent(company.id)}`;

  useEffect(() => {
    setBilling(null);
    setUnavailable(false);
    setMessage(null);
    const returning = new URLSearchParams(window.location.search).get("pago") === "retorno";
    const load = returning ? postJson<Billing>("/api/billing/sync", { company: company.id }) : fetchJson<Billing>(`/api/billing?${companyQuery}`);
    void load.then((value) => {
      if (!value) return setUnavailable(true);
      setBilling(value);
      if (returning) window.history.replaceState(null, "", "/plan");
    });
  }, [company.id, companyQuery]);

  const price = useMemo(() => {
    if (!billing) return null;
    const chosen = billing.agents.filter((agent) => selected.includes(agent.key));
    const subtotal = chosen.reduce((sum, agent) => sum + agent.priceCents, 0);
    const percent = discountFor(chosen.length, billing.discounts);
    return { subtotal, percent, total: Math.round((subtotal * (100 - percent)) / 100) };
  }, [billing, selected]);

  if (unavailable) {
    // Never a dead end: the heading and the way forward stay even without payments.
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Tu plan</h1>
        <p className="max-w-[60ch] rounded-2xl bg-surface-subtle px-5 py-4 text-ink-2">
          Los pagos en línea no están disponibles en este momento. Para sumar un agente a tu chat, escríbele a Manolo por WhatsApp
          y el equipo de MeowLab lo activa contigo.
        </p>
      </div>
    );
  }
  if (!billing || !price) return <div className="h-48 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando tu plan" />;

  const sub = billing.subscription;
  const live = sub && ["creating", "pending", "authorized", "paused"].includes(sub.status);

  async function subscribe() {
    setMessage(null);
    setBusy(true);
    const result = await postJson<{ status: string; checkoutUrl?: string; reason?: string }>("/api/billing/subscribe", {
      company: company.id,
      agents: selected,
      payerEmail,
    });
    if (result?.status === "redirect" && result.checkoutUrl) {
      window.location.assign(result.checkoutUrl);
      return;
    }
    setBusy(false);
    setMessage(
      result?.status === "invalid_email"
        ? "Revisa el correo de Mercado Pago."
        : result?.status === "already_subscribed"
          ? `${company.name} ya tiene una suscripción activa.`
          : result?.status === "test_account_mismatch"
            ? "En modo de prueba, el correo debe ser de una cuenta de prueba de Mercado Pago (termina en @testuser.com)."
          : result?.status === "invalid_agents"
            ? "Elige al menos un agente disponible."
            : "No pudimos abrir Mercado Pago. Inténtalo en unos minutos.",
    );
  }

  async function cancel() {
    setBusy(true);
    const result = await postJson<{ status: string }>("/api/billing/cancel", { company: company.id });
    const refreshed = await fetchJson<Billing>(`/api/billing?${companyQuery}`);
    setBusy(false);
    setConfirmCancel(false);
    if (refreshed) setBilling(refreshed);
    if (!result) setMessage("No pudimos cancelar. Inténtalo en unos minutos.");
  }

  const names = (keys: string[]) => billing.agents.filter((a) => keys.includes(a.key)).map((a) => a.name).join(" + ");

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Plan de {company.name}</h1>
        <p className="text-ink-muted">
          Cada empresa paga por los agentes que usa. Precios mensuales con IGV incluido.
        </p>
      </div>

      {!billing.canManage && (
        <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-2">
          Solo quien administra {company.name} puede contratar o cancelar agentes. Tú puedes ver el plan.
        </p>
      )}

      {billing.testMode && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Modo de prueba:</strong> los pagos usan cuentas de prueba de Mercado Pago y no cobran dinero real.
        </p>
      )}

      {sub && live && (
        <section className="rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="sub-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 id="sub-title" className="text-lg font-bold text-ink">{names(sub.agents)}</h3>
              <p className="font-title text-3xl font-bold tabular-nums text-ink">
                {soles(sub.amountCents)} <span className="text-base font-normal text-ink-muted">al mes</span>
              </p>
            </div>
            <span
              className={`chip border ${
                sub.active ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {sub.active ? "Pagado" : STATUS_LABEL[sub.status]}
            </span>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-surface-subtle px-4 py-3">
              <dt className="text-ink-muted">Pagado hasta</dt>
              <dd className="font-semibold text-ink">{date(sub.paidUntil)}</dd>
            </div>
            <div className="rounded-xl bg-surface-subtle px-4 py-3">
              <dt className="text-ink-muted">Próximo cobro</dt>
              <dd className="font-semibold text-ink">{sub.status === "authorized" ? date(sub.nextPaymentAt) : "—"}</dd>
            </div>
            <div className="rounded-xl bg-surface-subtle px-4 py-3">
              <dt className="text-ink-muted">Cuenta de Mercado Pago</dt>
              <dd className="truncate font-semibold text-ink">{sub.payerEmail}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {sub.status === "pending" && sub.checkoutUrl && (
              <a href={sub.checkoutUrl} className="btn-primary">Completar el pago en Mercado Pago</a>
            )}
            {!billing.canManage ? null : confirmCancel ? (
              <>
                <span className="text-sm text-ink-2">
                  ¿Cancelar la renovación? {sub.active ? `Tu plan sigue vigente hasta el ${date(sub.paidUntil)}.` : ""}
                </span>
                <button type="button" onClick={cancel} disabled={busy} className="btn-danger px-4 py-2.5 text-sm">Sí, cancelar</button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="btn-secondary px-4 py-2.5 text-sm">Volver</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmCancel(true)} className="btn-secondary px-4 py-2.5 text-sm">
                Cancelar suscripción
              </button>
            )}
          </div>
          {!sub.active && sub.status === "authorized" && (
            <p className="mt-4 text-sm text-ink-muted">
              Autorizaste el pago. Mercado Pago puede tardar unos minutos en cobrar la primera cuota; esta página se actualiza sola al volver.
            </p>
          )}
        </section>
      )}

      {!live && billing.canManage && (
        <section className="space-y-4" aria-labelledby="catalog-title">
          {sub?.active && (
            <p className="rounded-xl bg-mint-light px-4 py-3 text-sm text-ink-2">
              Cancelaste la renovación: tu plan sigue vigente hasta el {date(sub.paidUntil)}.
            </p>
          )}
          <h3 id="catalog-title" className="text-lg font-bold text-ink">Elige los agentes de {company.name}</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {billing.agents.map((agent) => {
              const checked = selected.includes(agent.key);
              return (
                <label
                  key={agent.key}
                  className={`flex cursor-pointer flex-col gap-2 rounded-2xl border p-5 transition-colors ${
                    !agent.available
                      ? "cursor-not-allowed border-line bg-surface-subtle/60 opacity-70"
                      : checked
                        ? "border-forest bg-mint-light"
                        : "border-line bg-white hover:border-line-mint"
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#0c493c]"
                        checked={checked}
                        disabled={!agent.available}
                        onChange={(e) =>
                          setSelected((current) => (e.target.checked ? [...current, agent.key] : current.filter((k) => k !== agent.key)))
                        }
                      />
                      <span className="font-title text-lg font-bold text-ink">{agent.name}</span>
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{soles(agent.priceCents)}</span>
                  </span>
                  <span className="text-sm text-ink-muted">{agent.description}</span>
                  {!agent.available && <span className="chip w-fit border border-line bg-white text-ink-muted">Próximamente</span>}
                </label>
              );
            })}
          </div>

          <div className="flex flex-col gap-4 rounded-3xl border border-line bg-white p-6 shadow-card lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm text-ink-muted">
                {price.percent > 0 ? `Subtotal ${soles(price.subtotal)} · descuento por equipo ${price.percent} %` : "Descuento de 10 % a 20 % al sumar agentes"}
              </p>
              <p className="font-title text-3xl font-bold tabular-nums text-ink">
                {soles(price.total)} <span className="text-base font-normal text-ink-muted">al mes</span>
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink-2">Correo de tu cuenta de Mercado Pago</span>
                <input className="field sm:w-72" type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} required />
              </label>
              <button type="button" onClick={subscribe} disabled={busy || selected.length === 0} className="btn-primary">
                {busy ? "Abriendo Mercado Pago…" : "Suscribirme con Mercado Pago"}
              </button>
            </div>
          </div>
          <p className="text-sm text-ink-muted">
            Mercado Pago cobra cada mes de forma automática. Puedes cancelar cuando quieras desde aquí; el plan sigue vigente hasta el fin del periodo pagado.
          </p>
        </section>
      )}

      {message && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p>
      )}
    </div>
  );
}
