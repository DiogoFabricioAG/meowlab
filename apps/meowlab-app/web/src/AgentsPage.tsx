import type { Membership } from "./auth-client";
import { AGENTS, agentState, monthlyPrice, type AgentState, type CatalogAgent, type Weekly } from "./agents";
import { Icon } from "./icons";

const BADGE: Record<AgentState["kind"], { text: string; tone: string }> = {
  active: { text: "Activo", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  setup: { text: "Falta un paso", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  available: { text: "Disponible", tone: "border-line bg-surface-subtle text-ink-2" },
  ask: { text: "Disponible", tone: "border-line bg-surface-subtle text-ink-2" },
  soon: { text: "Próximamente", tone: "border-line bg-white text-ink-muted" },
};

/**
 * «Tus agentes»: one card per agent with its state. All of them work inside the same
 * Manolo chat, so adding one never means a new WhatsApp number.
 */
export function AgentsPage({ company, weekly, catalog, go }: {
  company: Membership;
  weekly: Weekly | null;
  catalog: CatalogAgent[] | null;
  go: (path: string) => void;
}) {
  const cards = AGENTS.map((agent) => ({ ...agent, state: agentState(agent.key, company, weekly, catalog) }));
  const active = cards.filter((card) => card.state.kind === "active").length;
  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Tus agentes</h1>
        <p className="max-w-[62ch] text-lg text-ink-muted">
          {active
            ? `${active === 1 ? "Un agente trabaja" : `${active} agentes trabajan`} para ${company.name} dentro de tu chat con Manolo.`
            : `Todavía ningún agente trabaja para ${company.name}. Todos se activan dentro de tu chat con Manolo.`}
        </p>
      </header>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const state = card.state;
          const muted = state.kind === "soon";
          return (
            <li key={card.key}
              className={`flex flex-col gap-4 rounded-2xl border p-5 ${
                muted ? "border-dashed border-line-mint bg-white/60" : state.kind === "active" ? "border-line-mint bg-white shadow-card" : "border-line bg-white"
              }`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                    state.kind === "active" ? "bg-forest text-mint" : muted ? "bg-surface-subtle text-ink-muted" : "bg-mint text-forest"
                  }`}><Icon name={card.icon} /></span>
                  {card.name}
                </h2>
                <span className={`chip shrink-0 border ${BADGE[state.kind].tone}`}>{BADGE[state.kind].text}</span>
              </div>
              <p className="text-sm text-ink-muted">{card.does}</p>
              <div className="mt-auto space-y-3">
                {state.kind === "active" && (
                  <p className="rounded-xl bg-mint-light px-4 py-3 text-sm text-ink-2">{state.today}</p>
                )}
                {state.kind === "setup" && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.step}</p>}
                {state.kind === "ask" && <p className="text-sm text-ink-2">Pídeselo a Manolo por WhatsApp y lo activamos en tu chat.</p>}
                {(state.kind === "available" || state.kind === "soon") && monthlyPrice(state.priceCents) && (
                  <p className="text-sm font-semibold text-ink-2">{monthlyPrice(state.priceCents)}</p>
                )}
                {state.kind === "active" && card.detail && (
                  <button type="button" onClick={() => go(card.detail!)} className="btn-secondary min-h-11 w-full sm:w-auto"
                    aria-label={`Ver lo que hizo ${card.name}`}>
                    Ver lo que hizo
                  </button>
                )}
                {state.kind === "available" && (
                  <button type="button" onClick={() => go("/plan")} className="btn-secondary min-h-11 w-full sm:w-auto"
                    aria-label={`Sumar ${card.name} a mi chat`}>
                    Sumar a mi chat
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Tender Cat's detail: this week's tenders for the company's team. */
export function TenderPanel({ weekly, onBack }: { weekly: Weekly | null; onBack: () => void }) {
  const tenders = weekly?.tender.highlights ?? [];
  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline">
        <span aria-hidden="true">←</span> Tus agentes
      </button>
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Tender Cat</h1>
        <p className="text-lg text-ink-muted">
          {weekly
            ? `Esta semana encontró ${weekly.tender.found} ${weekly.tender.found === 1 ? "licitación" : "licitaciones"}; tu equipo marcó ${weekly.tender.interesting} como interesantes.`
            : "Revisando las licitaciones de la semana…"}
        </p>
      </header>
      {weekly && tenders.length === 0 && (
        <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
          Esta semana no hubo licitaciones para tu negocio. Tender Cat te escribe por WhatsApp apenas aparezca una.
        </p>
      )}
      {tenders.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {tenders.map((tender) => (
            <li key={`${tender.description}-${tender.deadline}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-semibold text-ink">
                  {tender.interesting && <span className="chip mr-2 border border-emerald-200 bg-emerald-50 text-emerald-800">Interesante</span>}
                  {tender.description}
                </div>
                <div className="text-sm text-ink-muted">{tender.buyer} · cierra {tender.deadline}{tender.amount ? ` · ${tender.amount}` : ""}</div>
              </div>
              {tender.sourceUrl && (
                <a href={tender.sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline">
                  Ver en SEACE <Icon name="external" className="h-4 w-4" /><span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-muted">Para marcar una licitación como interesante, respóndele a Tender Cat en el chat de Manolo.</p>
    </div>
  );
}
