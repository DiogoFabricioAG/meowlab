import { useState } from "react";
import { authClient, type Me } from "./auth-client";
import { Logo } from "./App";
import { WhatsAppLink } from "./WhatsAppLink";
import { AdminPanel } from "./AdminPanel";
import { PlanPanel } from "./PlanPanel";
import { InvoicingPanel } from "./InvoicingPanel";
import { CompanyCards, CompanyStep } from "./CompanyStep";

// Per-browser convenience: «Lo hago después» hides the step until the person reopens it.
const SKIP_KEY = "meowlab.companyStep.skipped";
const readSkip = () => {
  try {
    return window.localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
};
const writeSkip = (value: boolean) => {
  try {
    if (value) window.localStorage.setItem(SKIP_KEY, "1");
    else window.localStorage.removeItem(SKIP_KEY);
  } catch {
    // Storage blocked: the step simply shows again next time.
  }
};

const BILLING_FEATURES = [
  "Facturas, boletas y notas con su estado en SUNAT",
  "Descarga de PDF, XML y CDR",
  "Resumen mensual de ventas e IGV",
  "Guías de remisión emitidas",
];

export function Panel({ me, onChange, onInvitation }: { me: Me; onChange: () => void; onInvitation: (code: string) => void }) {
  const [leaving, setLeaving] = useState(false);
  const invoicingAvailable = me.modules.some((module) => module.key === "billing" && module.status === "available");
  const [tab, setTab] = useState<"panel" | "invoicing" | "plan" | "business">(
    new URLSearchParams(window.location.search).get("pago") === "retorno" ? "plan" : "panel",
  );
  const firstName = me.user.name.trim().split(/\s+/)[0] || "hola";
  const [skipped, setSkipped] = useState(readSkip);
  const withoutCompany = me.companies !== null && me.companies.length === 0;

  async function signOut() {
    setLeaving(true);
    await authClient.signOut();
  }

  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-ink">{me.user.name}</div>
              <div className="text-[13px] text-ink-muted">{me.user.email}</div>
            </div>
            <Avatar name={me.user.name} image={me.user.image} />
            <button type="button" onClick={signOut} disabled={leaving} className="btn-secondary px-4 py-2.5 text-sm">
              Salir
            </button>
          </div>
        </div>
      </header>

      <nav className="border-b border-line bg-white" aria-label="Secciones">
        <div className="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6 lg:px-8">
          {([["panel", "Mi panel"], ...(invoicingAvailable ? [["invoicing", "Facturación"]] : []), ["plan", "Plan"], ...(me.isAdmin ? [["business", "Negocio"]] : [])] as Array<[typeof tab, string]>).map(
            ([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={tab === key ? "page" : undefined}
                className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                  tab === key ? "border-forest text-forest" : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </nav>

      {tab === "invoicing" && invoicingAvailable ? (
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <InvoicingPanel />
        </main>
      ) : tab === "plan" ? (
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <PlanPanel email={me.user.email} />
        </main>
      ) : me.isAdmin && tab === "business" ? (
        <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <AdminPanel />
        </main>
      ) : (
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Hola, {firstName}</h1>
          <p className="max-w-[60ch] text-lg text-ink-muted">
            Este es tu panel de MeowLab. Cada agente que uses por WhatsApp tendrá aquí su espacio.
          </p>
        </div>

        {withoutCompany && !skipped && (
          <CompanyStep
            onInvitation={onInvitation}
            onDone={() => {
              writeSkip(false);
              onChange();
            }}
            onSkip={() => {
              writeSkip(true);
              setSkipped(true);
            }}
          />
        )}
        {withoutCompany && skipped && (
          <section className="flex flex-col gap-3 rounded-3xl border border-dashed border-line bg-surface-subtle/60 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-ink">Todavía no estás en una empresa</h2>
              <p className="text-ink-muted">Crea la tuya con tu RUC o únete a la de tu equipo con una invitación.</p>
            </div>
            <button
              type="button"
              className="btn-secondary w-fit"
              onClick={() => {
                writeSkip(false);
                setSkipped(false);
              }}
            >
              Elegir ahora
            </button>
          </section>
        )}
        {me.companies && me.companies.length > 0 && <CompanyCards companies={me.companies} />}

        <WhatsAppLink whatsapp={me.whatsapp} onChange={onChange} />

        <section className="space-y-4" aria-labelledby="modules-title">
          <h2 id="modules-title" className="text-xl font-bold tracking-tight text-ink">
            Tus agentes
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {me.modules.map((module) => (
              <article key={module.key} className="flex flex-col gap-5 rounded-3xl border border-line bg-white p-6 shadow-card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 shrink-0 rounded-xl border border-[#d6e2ec] bg-[#f3f7fa] p-1">
                      <img
                        src="/gato-facturas-light.webp"
                        alt=""
                        width={48}
                        height={48}
                        className="h-full w-full object-contain mix-blend-multiply"
                        decoding="async"
                      />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-ink">{module.title}</h3>
                      <p className="text-sm text-ink-muted">Agente de Facturas · FacturaYa</p>
                    </div>
                  </div>
                  <StatusChip status={module.status} />
                </div>
                <ul className="space-y-2">
                  {BILLING_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-ink-2">
                      <svg viewBox="0 0 20 20" className="mt-1 h-4 w-4 shrink-0 text-forest" aria-hidden="true">
                        <path fill="currentColor" d="M8 13.6 4.4 10l-1.4 1.4L8 16.4l9-9L15.6 6z" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                {module.status === "available" && (
                  <button type="button" onClick={() => setTab("invoicing")} className="btn-primary w-fit">
                    Ver mis comprobantes
                  </button>
                )}
                {module.status === "no_company" && (
                  <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                    Tu WhatsApp está vinculado, pero todavía no es miembro de ninguna empresa con facturación electrónica activa.
                    Crea tu empresa o pide al dueño que te invite.
                  </p>
                )}
                {module.status === "coming_soon" && (
                  <p className="rounded-xl bg-mint-light px-4 py-3 text-sm text-ink-2">
                    Tu WhatsApp ya está vinculado. Tus comprobantes aparecerán aquí en la próxima entrega del panel.
                  </p>
                )}
                {module.status === "needs_whatsapp" && (
                  <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                    Se abre cuando vincules tu WhatsApp y Manolo confirme que tienes este agente activo.
                  </p>
                )}
              </article>
            ))}
            <article className="flex flex-col justify-center gap-2 rounded-3xl border border-dashed border-line bg-surface-subtle/60 p-6">
              <h3 className="text-lg font-bold text-ink">Más agentes en camino</h3>
              <p className="text-ink-muted">
                Cotizaciones, licitaciones y tu negocio tendrán su propio espacio a medida que los actives.
              </p>
            </article>
          </div>
        </section>
      </main>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: Me["modules"][number]["status"] }) {
  if (status === "available") {
    return <span className="chip border border-emerald-200 bg-emerald-50 text-emerald-800">Activo</span>;
  }
  if (status === "coming_soon") {
    return <span className="chip border border-line bg-surface-subtle text-ink-muted">Próximamente</span>;
  }
  if (status === "no_company") {
    return <span className="chip border border-amber-200 bg-amber-50 text-amber-800">Sin empresa</span>;
  }
  return <span className="chip border border-amber-200 bg-amber-50 text-amber-800">Falta WhatsApp</span>;
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return <img src={image} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />;
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return (
    <span className="grid h-10 w-10 place-items-center rounded-full bg-mint font-title text-sm font-bold text-forest">
      {initials || "M"}
    </span>
  );
}
