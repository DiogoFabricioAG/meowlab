import { useEffect, useMemo, useState } from "react";
import { agentLogo, type AgentKey } from "./agents";
import { fetchJson, postJson, type Membership } from "./auth-client";
import { Icon } from "./icons";
import { PageHeader } from "./PageHeader";
import {
  AGENT_PITCH,
  PLAN_BUNDLES,
  calculatePlanQuote,
  nextDiscountNudge,
  type PlanAgent,
  type PlanDiscount,
} from "./planCatalog";
import { PlanFaqSection, PlanTrustSection } from "./PlanSalesSections";

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
type Billing = {
  agents: PlanAgent[];
  discounts: PlanDiscount[];
  testMode?: boolean;
  subscription: Subscription | null;
  canManage?: boolean;
};

const soles = (cents: number) => `S/ ${(cents / 100).toFixed(2)}`;
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" }) : "—";

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
  const [selected, setSelected] = useState<string[]>(["sales", "invoice"]);
  const [payerEmail, setPayerEmail] = useState(email);
  const [editingEmail, setEditingEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showChangeNotice, setShowChangeNotice] = useState(false);

  const companyQuery = `company=${encodeURIComponent(company.id)}`;

  useEffect(() => {
    setBilling(null);
    setUnavailable(false);
    setMessage(null);
    const returning = new URLSearchParams(window.location.search).get("pago") === "retorno";
    const load = returning
      ? postJson<Billing>("/api/billing/sync", { company: company.id })
      : fetchJson<Billing>(`/api/billing?${companyQuery}`);
    void load.then((value) => {
      if (!value) return setUnavailable(true);
      setBilling(value);
      const availableKeys = new Set(value.agents.filter((a) => a.available).map((a) => a.key));
      setSelected((current) => {
        const valid = current.filter((k) => availableKeys.has(k));
        return valid.length ? valid : value.agents.filter((a) => a.available).slice(0, 2).map((a) => a.key);
      });
      if (returning) window.history.replaceState(null, "", "/plan");
    });
  }, [company.id, companyQuery]);

  const price = useMemo(() => {
    if (!billing) return null;
    return calculatePlanQuote(selected, billing.agents, billing.discounts);
  }, [billing, selected]);

  if (unavailable) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={company.name} title="Arma el equipo de gatos de tu negocio" />
        <p className="max-w-[60ch] rounded-2xl bg-surface-subtle px-5 py-4 text-ink-2">
          Los pagos en línea no están disponibles en este momento. Para sumar un agente a tu chat, escríbele a MeowLab por WhatsApp
          y el equipo de MeowLab lo activa contigo.
        </p>
      </div>
    );
  }
  if (!billing || !price) {
    return <div className="h-48 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando tu plan" />;
  }

  const sub = billing.subscription;
  const live = sub && ["creating", "pending", "authorized", "paused"].includes(sub.status);
  const nudge = nextDiscountNudge(price.selectedKeys.length, billing.discounts);
  const chosenAgents = billing.agents.filter((agent) => price.selectedKeys.includes(agent.key));

  async function subscribe() {
    setMessage(null);
    setBusy(true);
    const result = await postJson<{ status: string; checkoutUrl?: string; reason?: string }>("/api/billing/subscribe", {
      company: company.id,
      agents: price?.selectedKeys ?? selected,
      payerEmail,
    });
    if (result?.status === "redirect" && result.checkoutUrl) {
      window.location.assign(result.checkoutUrl);
      return;
    }
    setBusy(false);
    if (result?.status === "invalid_email" || result?.status === "test_account_mismatch") setEditingEmail(true);
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

  function toggleAgent(key: string) {
    setSelected((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  }

  const names = (keys: string[]) => billing.agents.filter((a) => keys.includes(a.key)).map((a) => a.name).join(" + ");

  return (
    <div className={`space-y-8 ${!live && billing.canManage ? "pb-24 lg:pb-0" : ""}`}>
      <PageHeader
        eyebrow={company.name}
        title="Arma el equipo de gatos de tu negocio"
        subtitle="Pagas solo por los que usas. Cancela cuando quieras."
      />

      {!billing.canManage && (
        <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-sm text-ink-2">
          Solo quien administra {company.name} puede contratar o cancelar agentes. Tú puedes ver el plan.
        </p>
      )}

      {billing.testMode && (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Modo de prueba:</strong> los pagos usan cuentas de prueba de Mercado Pago y no cobran dinero real.
        </p>
      )}

      {sub && live && (
        <section className="rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="sub-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-forest">Plan actual de {company.name}</p>
              <h2 id="sub-title" className="text-2xl text-ink">{names(sub.agents)}</h2>
              <p className="font-sans text-3xl font-semibold tabular-nums text-ink">
                {soles(sub.amountCents)} <span className="text-base font-normal text-ink-muted">al mes · IGV incluido</span>
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
            <div className="rounded-2xl bg-surface-subtle px-4 py-3">
              <dt className="text-ink-muted">Pagado hasta</dt>
              <dd className="font-semibold text-ink">{date(sub.paidUntil)}</dd>
            </div>
            <div className="rounded-2xl bg-surface-subtle px-4 py-3">
              <dt className="text-ink-muted">Próximo cobro</dt>
              <dd className="font-semibold text-ink">{sub.status === "authorized" ? date(sub.nextPaymentAt) : "—"}</dd>
            </div>
            <div className="rounded-2xl bg-surface-subtle px-4 py-3">
              <dt className="text-ink-muted">Cuenta de Mercado Pago</dt>
              <dd className="truncate font-semibold text-ink">{sub.payerEmail}</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {sub.status === "pending" && sub.checkoutUrl && (
              <a href={sub.checkoutUrl} className="btn-primary">Completar el pago en Mercado Pago</a>
            )}
            {billing.canManage && (
              <button
                type="button"
                onClick={() => setShowChangeNotice((open) => !open)}
                className="btn-secondary px-4 py-2.5 text-sm"
              >
                Cambiar gatos
              </button>
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

          {showChangeNotice && (
            <p className="mt-4 rounded-2xl bg-mint-light px-4 py-3 text-sm text-ink-2">
              Para cambiar los gatos de tu suscripción, cancela primero esta renovación (seguirás con acceso hasta el{" "}
              <strong className="font-semibold text-ink">{date(sub.paidUntil)}</strong>) y elige tu nuevo equipo aquí mismo.
            </p>
          )}

          {!sub.active && sub.status === "authorized" && (
            <p className="mt-4 text-sm text-ink-muted">
              Autorizaste el pago. Mercado Pago puede tardar unos minutos en cobrar la primera cuota; esta página se actualiza sola al volver.
            </p>
          )}
        </section>
      )}

      {!live && billing.canManage && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="min-w-0 space-y-8">
            {sub?.active && (
              <p className="rounded-2xl bg-mint-light px-5 py-4 text-sm text-ink-2">
                Cancelaste la renovación: tu plan sigue vigente hasta el {date(sub.paidUntil)}.
              </p>
            )}

            <section className="space-y-4" aria-labelledby="bundles-title">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="bundles-title" className="text-xl text-ink">Paquetes sugeridos</h2>
                <span className="text-sm text-ink-muted">Elige uno con un toque o arma tu propia combinación.</span>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {PLAN_BUNDLES.map((bundle) => {
                  const bundleKeys = bundle.keys(billing.agents);
                  const bundleQuote = calculatePlanQuote(bundleKeys, billing.agents, billing.discounts);
                  const isActiveBundle =
                    bundleQuote.selectedKeys.length > 0 &&
                    bundleQuote.selectedKeys.length === price.selectedKeys.length &&
                    bundleQuote.selectedKeys.every((key) => price.selectedKeys.includes(key));
                  return (
                    <button
                      key={bundle.id}
                      type="button"
                      onClick={() => setSelected(bundleQuote.selectedKeys)}
                      aria-pressed={isActiveBundle}
                      className={`flex flex-col justify-between gap-4 rounded-3xl border p-5 text-left transition-colors ${
                        isActiveBundle
                          ? "border-forest bg-mint-light shadow-card"
                          : "border-line bg-white shadow-soft hover:border-line-mint"
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-title text-lg text-ink">{bundle.name}</span>
                          {bundle.popular && (
                            <span className="chip bg-forest text-white">Más elegido</span>
                          )}
                        </div>
                        <p className="text-sm text-ink-muted">{bundle.tagline}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="font-sans text-2xl font-semibold tabular-nums text-ink">
                          {soles(bundleQuote.totalCents)} <span className="text-sm font-normal text-ink-muted">/ mes</span>
                        </p>
                        <p className="text-xs font-semibold text-forest">
                          {bundleQuote.savingsCents > 0
                            ? `Ahorras ${soles(bundleQuote.savingsCents)} (${bundleQuote.discountPercent} % dto.)`
                            : `${bundleQuote.selectedKeys.length} gatos`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="catalog-title">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="catalog-title" className="text-xl text-ink">Elige tus gatos</h2>
                <span className="text-sm font-semibold text-forest">10 % desde 2 gatos · 15 % desde 3 · 20 % desde 5</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {billing.agents.map((agent) => {
                  const checked = price.selectedKeys.includes(agent.key);
                  const pitch = AGENT_PITCH[agent.key as AgentKey];
                  return (
                    <article
                      key={agent.key}
                      className={`flex flex-col justify-between gap-4 rounded-3xl border p-5 transition-colors ${
                        !agent.available
                          ? "border-line bg-surface-subtle/60 opacity-75"
                          : checked
                            ? "border-forest bg-mint-light/70 shadow-card"
                            : "border-line bg-white shadow-soft hover:border-line-mint"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-mint">
                              <img
                                src={agentLogo(agent.key as AgentKey)}
                                alt=""
                                width={40}
                                height={40}
                                className="h-10 w-10 mix-blend-multiply"
                                decoding="async"
                              />
                            </span>
                            <div>
                              <h3 className="text-lg text-ink">{agent.name}</h3>
                              <p className="font-sans text-sm font-semibold tabular-nums text-ink-2">{soles(agent.priceCents)} / mes</p>
                            </div>
                          </div>
                          {!agent.available ? (
                            <span className="chip border border-line bg-white text-ink-muted">Próximamente</span>
                          ) : (
                            <button
                              type="button"
                              aria-pressed={checked}
                              onClick={() => toggleAgent(agent.key)}
                              className={`min-h-10 shrink-0 rounded-[10px] px-3.5 text-sm font-semibold transition-colors ${
                                checked
                                  ? "bg-forest text-white hover:bg-forest-hover"
                                  : "border border-line bg-white text-ink hover:border-forest"
                              }`}
                            >
                              {checked ? "En tu plan" : "Agregar"}
                            </button>
                          )}
                        </div>

                        {pitch && (
                          <p className="inline-block rounded-full bg-surface-subtle px-3 py-1 text-xs font-semibold text-forest">
                            {pitch.idealIf}
                          </p>
                        )}

                        {pitch ? (
                          <ul className="space-y-1.5 text-sm text-ink-2">
                            {pitch.benefits.map((benefit) => (
                              <li key={benefit} className="flex items-start gap-2">
                                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                                <span>{benefit}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-ink-muted">{agent.description}</p>
                        )}

                        {agent.key === "invoice" && (
                          <p className="text-xs font-semibold text-forest">Después del pago, conecta tu clave SOL de SUNAT.</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <PlanTrustSection />
            <PlanFaqSection />
          </div>

          <aside className="hidden rounded-3xl border border-line bg-white p-6 shadow-card lg:sticky lg:top-6 lg:block" aria-label="Resumen de tu plan">
            <h2 className="text-xl text-ink">Tu resumen</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {chosenAgents.length
                ? `${chosenAgents.length} ${chosenAgents.length === 1 ? "gato elegido" : "gatos elegidos"}`
                : "Elige al menos un gato"}
            </p>

            {chosenAgents.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
                {chosenAgents.map((agent) => (
                  <li key={agent.key} className="flex items-center justify-between gap-2 py-2.5">
                    <span className="font-medium text-ink">{agent.name}</span>
                    <span className="tabular-nums text-ink-muted">{soles(agent.priceCents)}</span>
                  </li>
                ))}
              </ul>
            )}

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between text-ink-muted">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{soles(price.subtotalCents)}</dd>
              </div>
              {price.discountPercent > 0 && (
                <div className="flex justify-between font-semibold text-forest">
                  <dt>Descuento por equipo ({price.discountPercent} %)</dt>
                  <dd className="tabular-nums">-{soles(price.savingsCents)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="font-semibold text-ink">Total al mes (IGV incl.)</dt>
                <dd className="font-sans text-2xl font-semibold tabular-nums text-ink">{soles(price.totalCents)}</dd>
              </div>
            </dl>

            {nudge && (
              <p className="mt-3 rounded-2xl bg-mint-light px-3.5 py-2.5 text-xs font-semibold text-forest">
                Agrega {nudge.needed} {nudge.needed === 1 ? "gato más" : "gatos más"} y ahorra {nudge.nextPercent} %
              </p>
            )}

            <div className="mt-5 space-y-3">
              {editingEmail ? (
                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold text-ink-2">Correo de tu cuenta de Mercado Pago</span>
                  <input className="field w-full" type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} required autoFocus />
                </label>
              ) : null}
              <button
                type="button"
                onClick={subscribe}
                disabled={busy || price.selectedKeys.length === 0}
                className="btn-primary w-full"
              >
                {busy ? "Abriendo Mercado Pago…" : "Suscribirme con Mercado Pago"}
              </button>
              {!editingEmail && (
                <p className="text-xs text-ink-muted">
                  Pagarás con la cuenta de Mercado Pago de <span className="font-semibold text-ink-2">{payerEmail}</span>.{" "}
                  <button type="button" onClick={() => setEditingEmail(true)} className="font-semibold text-forest underline-offset-4 hover:underline">
                    Usar otro correo
                  </button>
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      {!live && billing.canManage && (
        <div className="fixed inset-x-0 bottom-[4.25rem] z-10 border-t border-line bg-white/95 px-4 py-3 shadow-elevated backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs text-ink-muted">
                {price.discountPercent > 0 ? `${price.selectedKeys.length} gatos · ${price.discountPercent} % dto.` : `${price.selectedKeys.length} gatos`}
              </p>
              <p className="font-sans text-lg font-semibold tabular-nums text-ink">
                {soles(price.totalCents)} <span className="text-xs font-normal text-ink-muted">/ mes</span>
              </p>
            </div>
            <button
              type="button"
              onClick={subscribe}
              disabled={busy || price.selectedKeys.length === 0}
              className="btn-primary shrink-0 px-4 py-2.5 text-sm"
            >
              {busy ? "Abriendo…" : "Suscribirme"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p>
      )}
    </div>
  );
}
