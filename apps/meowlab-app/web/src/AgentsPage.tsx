import type { Membership } from "./auth-client";
import { AGENTS, agentLogo, agentState, monthlyPrice, type AgentState, type CatalogAgent, type Weekly } from "./agents";
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
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${muted ? "bg-surface-subtle" : "bg-mint"}`}>
                    <img src={agentLogo(card.key)} alt="" width={40} height={40}
                      className={`h-10 w-10 mix-blend-multiply ${muted ? "opacity-50 grayscale" : ""}`} decoding="async" />
                  </span>
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
