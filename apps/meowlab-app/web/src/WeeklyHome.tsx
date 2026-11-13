import type { Me, Membership } from "./auth-client";
import { AGENTS, agentState, type CatalogAgent, type Weekly } from "./agents";
import { Icon } from "./icons";

const soles = (value: string) =>
  `S/ ${Number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const longDay = (iso: string) => {
  const text = new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function change(current: number, previous: number): string | null {
  if (previous <= 0) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return "igual que la semana pasada";
  return `${percent > 0 ? "+" : ""}${percent}% frente a la semana pasada`;
}

/**
 * «Inicio» for the business owner: what the agents did today, in plain sentences, what
 * needs her attention, and a one-line look at the week. Real data only.
 */
export function WeeklyHome({ me, company, weekly, failed, catalog, go }: {
  me: Me;
  company: Membership;
  weekly: Weekly | null;
  failed: boolean;
  catalog: CatalogAgent[] | null;
  go: (path: string) => void;
}) {
  const firstName = me.user.name.trim().split(/\s+/)[0] || "hola";
  const active = AGENTS.map((agent) => ({ agent, state: agentState(agent.key, company, weekly, catalog) }))
    .filter((entry) => entry.state.kind === "active");
  const invoicing = weekly?.invoicing && weekly.invoicing.status === "ok" ? weekly.invoicing : null;
  const attention = [
    ...(invoicing?.rejected ?? []).map((doc) => ({
      key: `doc-${doc.number}`,
      icon: "alert" as const,
      tone: "text-amber-700",
      title: `${doc.number} rechazado por SUNAT${doc.customer ? ` · ${doc.customer}` : ""}`,
      text: doc.message ?? "Revisa el comprobante en Invoice Cat.",
      action: { label: "Ver en Invoice Cat", go: () => go("/agentes/facturas") },
    })),
    ...(weekly?.tender.highlights ?? []).filter((tender) => tender.interesting).map((tender) => ({
      key: `tender-${tender.description}-${tender.deadline}`,
      icon: "star" as const,
      tone: "text-forest",
      title: tender.description,
      text: `${tender.buyer} · cierra ${tender.deadline}${tender.amount ? ` · ${tender.amount}` : ""}`,
      action: tender.sourceUrl ? { label: "Ver en SEACE", href: tender.sourceUrl } : null,
    })),
  ];
  const sales = invoicing ? change(Number(invoicing.totalPen), Number(invoicing.previousTotalPen)) : null;

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <p className="text-sm font-semibold text-ink-muted">{weekly ? longDay(weekly.today) : "Hoy"}</p>
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Hola, {firstName}</h1>
        <p className="text-lg text-ink-muted">Esto hicieron hoy tus agentes en el chat de Manolo para {company.name}</p>
      </header>

      {!me.whatsapp.linked && (
        <button type="button" onClick={() => go("/ajustes")}
          className="flex w-full items-center justify-between gap-4 rounded-2xl border border-line-mint bg-mint-light px-5 py-4 text-left">
          <span>
            <span className="block font-semibold text-ink">Vincula tu WhatsApp</span>
            <span className="block text-sm text-ink-2">Así Manolo te reconoce y lo que hagas en el chat aparece aquí.</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-forest">Ir a Configuración</span>
        </button>
      )}

      {failed && <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">No pudimos cargar lo de hoy. Vuelve a intentarlo en unos minutos.</p>}

      <section className="space-y-3" aria-labelledby="today-title">
        <h2 id="today-title" className="text-xl font-bold tracking-tight text-ink">Hoy</h2>
        {!weekly && !failed && <div className="h-32 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando" />}
        {weekly && (
          active.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-5 py-4">
              <p className="text-ink-2">Todavía ningún agente trabaja para {company.name}.</p>
              <button type="button" onClick={() => go("/agentes")} className="mt-3 min-h-11 font-semibold text-forest underline-offset-4 hover:underline">
                Ver los agentes que puedes sumar
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
              {active.map(({ agent, state }) => (
                <li key={agent.key}>
                  <button type="button" onClick={() => go(agent.detail ?? "/agentes")}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-surface-subtle/60">
                    <span className="mt-0.5 text-forest"><Icon name={agent.icon} /></span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{agent.name}</span>
                      <span className="block text-ink-2">{state.kind === "active" ? state.today : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
              <li className="flex items-start gap-3 px-5 py-4">
                <span className="mt-0.5 text-ink-muted"><Icon name="message" /></span>
                <span className="text-ink-2">
                  {weekly.team.messagesToday
                    ? `Tu equipo le escribió ${weekly.team.messagesToday} ${weekly.team.messagesToday === 1 ? "mensaje" : "mensajes"} a Manolo.`
                    : "Hoy nadie de tu equipo le escribió a Manolo."}
                </span>
              </li>
            </ul>
          )
        )}
      </section>

      {weekly && (
        <section className="space-y-3" aria-labelledby="attention-title">
          <h2 id="attention-title" className="text-xl font-bold tracking-tight text-ink">Para atender</h2>
          {attention.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-5 py-4 text-ink-muted">
              Nada pendiente: esta semana no hay comprobantes rechazados ni licitaciones marcadas como interesantes.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
              {attention.map((item) => (
                <li key={item.key} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className={`mt-0.5 shrink-0 ${item.tone}`}><Icon name={item.icon} /></span>
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{item.title}</div>
                      <div className="text-sm text-ink-muted">{item.text}</div>
                    </div>
                  </div>
                  {item.action && ("href" in item.action ? (
                    <a href={item.action.href} target="_blank" rel="noopener noreferrer"
                      className="inline-flex min-h-11 shrink-0 items-center gap-1 pl-8 text-sm font-semibold text-forest underline-offset-4 hover:underline sm:pl-0">
                      {item.action.label} <Icon name="external" className="h-4 w-4" /><span className="sr-only">(se abre en otra pestaña)</span>
                    </a>
                  ) : (
                    <button type="button" onClick={item.action.go}
                      className="inline-flex min-h-11 shrink-0 items-center pl-8 text-left text-sm font-semibold text-forest underline-offset-4 hover:underline sm:pl-0">
                      {item.action.label}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {weekly && (
        <section className="space-y-3" aria-labelledby="week-title">
          <h2 id="week-title" className="text-xl font-bold tracking-tight text-ink">Esta semana</h2>
          <dl className="grid gap-3 rounded-2xl bg-surface-subtle p-5 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-ink-muted">Facturado (aceptado por SUNAT)</dt>
              <dd className="text-xl font-bold text-ink tabular-nums">{invoicing ? soles(invoicing.totalPen) : "—"}</dd>
              {sales && <dd className="text-sm text-ink-muted">{sales}</dd>}
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Comprobantes emitidos</dt>
              <dd className="text-xl font-bold text-ink tabular-nums">{invoicing ? invoicing.documents : "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">Licitaciones encontradas</dt>
              <dd className="text-xl font-bold text-ink tabular-nums">{weekly.tender.enabled ? weekly.tender.found : "—"}</dd>
            </div>
          </dl>
          {invoicing?.partial && <p className="text-sm text-ink-muted">Semana con muchos comprobantes: el total considera los primeros 200.</p>}
        </section>
      )}

      {company.role === "owner" && (
        <button type="button" onClick={() => go("/ajustes/equipo")}
          className="flex w-full items-center gap-3 rounded-2xl border border-line px-5 py-4 text-left hover:border-forest">
          <span className="text-forest"><Icon name="users" /></span>
          <span>
            <span className="block font-semibold text-ink">Invita a tu equipo</span>
            <span className="block text-sm text-ink-muted">Quien venda contigo puede usar a tus agentes desde su propio WhatsApp.</span>
          </span>
        </button>
      )}
    </div>
  );
}
