import { useState } from "react";
import { authClient, type Me } from "./auth-client";
import { Logo } from "./App";

const LINK_STEPS = [
  { n: "1", text: "Escribe aquí el número con el que hablas con Manolo." },
  { n: "2", text: "Te damos un código para enviárselo desde tu WhatsApp." },
  { n: "3", text: "Manolo confirma que el número es tuyo y se abren tus datos." },
];

const BILLING_FEATURES = [
  "Facturas, boletas y notas con su estado en SUNAT",
  "Descarga de PDF, XML y CDR",
  "Resumen mensual de ventas e IGV",
  "Guías de remisión emitidas",
];

export function Panel({ me }: { me: Me }) {
  const [leaving, setLeaving] = useState(false);
  const firstName = me.user.name.trim().split(/\s+/)[0] || "hola";

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

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Hola, {firstName}</h1>
          <p className="max-w-[60ch] text-lg text-ink-muted">
            Este es tu panel de MeowLab. Cada agente que uses por WhatsApp tendrá aquí su espacio.
          </p>
        </div>

        {!me.whatsapp.linked && (
          <section className="rounded-3xl border border-line-mint bg-mint-light p-6 sm:p-8" aria-labelledby="link-title">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2 lg:max-w-md">
                <span className="chip border border-line-mint bg-white text-forest">
                  <span className="h-2 w-2 rounded-full bg-whatsapp" aria-hidden="true" /> Primer paso
                </span>
                <h2 id="link-title" className="text-2xl font-bold tracking-tight text-ink">
                  Vincula tu WhatsApp
                </h2>
                <p className="text-ink-2">
                  Tus datos están asociados al número con el que hablas con Manolo. Lo vincularás confirmándolo desde tu
                  propio WhatsApp.
                </p>
              </div>
              <ol className="grid gap-3 sm:grid-cols-3 lg:max-w-xl">
                {LINK_STEPS.map((step) => (
                  <li key={step.n} className="rounded-2xl bg-white p-4 shadow-soft">
                    <span className="mb-2 grid h-8 w-8 place-items-center rounded-lg bg-mint text-sm font-bold text-forest">
                      {step.n}
                    </span>
                    <span className="block text-sm leading-relaxed text-ink-2">{step.text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="mt-6 flex flex-col gap-3 border-t border-line-mint pt-6 sm:flex-row sm:items-center">
              <button type="button" disabled className="btn-primary">
                Vincular mi número
              </button>
              <span className="text-sm text-ink-muted">La vinculación se habilita en la próxima entrega del panel.</span>
            </div>
          </section>
        )}

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
                      <img src="/gato-facturas-light.svg" alt="" className="h-full w-full object-contain mix-blend-multiply" />
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
