import { useEffect, useState } from "react";
import type { Membership } from "./auth-client";
import { fetchJson } from "./auth-client";
import { AGENTS, agentLogo, agentState, type AgentKey, type AgentState, type CatalogAgent, type CompanyActivity, type Weekly } from "./agents";
import { councilAdvice, peopleLine, peopleReport, percentChange, soles, weekOverWeek, type CouncilAdvice, type PeopleRow } from "./council";
import { buildSeriesMetrics, type TrendMetric } from "./HomeActivity";
import { Icon } from "./icons";
import { PageHeader } from "./PageHeader";
import "./council.css";

type Seat = { key: AgentKey; name: string; detail?: string; state: AgentState; advice: CouncilAdvice };

const SEATED: ReadonlyArray<AgentState["kind"]> = ["active", "setup"];
const ORDER: Record<AgentState["kind"], number> = { active: 0, setup: 1, available: 2, ask: 3, soon: 3 };

/**
 * «Tus agentes» as the council of cats: how the business is going and what to improve.
 * Inicio answers what to do now and what the cats did today; the council never repeats
 * that. Each cat speaks once, from real data (`council.ts`); the trend the council looks
 * at and who talks to each cat sit below the table.
 */
export function AgentsPage({ company, weekly, catalog, go }: {
  company: Membership;
  weekly: Weekly | null;
  catalog: CatalogAgent[] | null;
  go: (path: string) => void;
}) {
  // undefined while loading, null when it failed.
  const [activity, setActivity] = useState<CompanyActivity | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setActivity(undefined);
    void fetchJson<CompanyActivity>(`/api/companies/${encodeURIComponent(company.id)}/activity`)
      .then((value) => { if (alive) setActivity(value ?? null); })
      .catch(() => { if (alive) setActivity(null); });
    return () => { alive = false; };
  }, [company.id]);

  const seats: Seat[] = AGENTS.map((agent) => {
    const state = agentState(agent.key, company, weekly, catalog);
    return { key: agent.key, name: agent.name, detail: agent.detail, state,
      advice: councilAdvice(agent.key, agent.name, state, weekly, activity ?? null, Boolean(company.ruc)) };
  });
  const seated = seats.filter((seat) => SEATED.includes(seat.state.kind));
  const people = peopleReport(weekly, seated.map((seat) => seat.key));
  const peopleBy = new Map(people?.rows.map((row) => [row.agent, row]) ?? []);
  const session = [...seats].sort((a, b) => ORDER[a.state.kind] - ORDER[b.state.kind]);
  const working = seats.filter((seat) => seat.state.kind === "active").length;

  const open = (path: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    go(path);
  };
  const focusSeat = (key: AgentKey) => {
    const element = document.getElementById(`consejo-${key}`);
    element?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={company.name}
        title="Tus agentes"
        subtitle="Tu consejo de gatos se reúne para ver cómo va tu negocio y qué puedes mejorar."
      />

      <section aria-labelledby="council-session" className="council-table-layout">
        <div className="council-table-stage" aria-label="Integrantes del consejo">
          <svg className="council-table-art" viewBox="0 0 440 350" aria-hidden="true">
            <ellipse cx="220" cy="185" rx="134" ry="106" fill="var(--color-forest-dark)" />
            <ellipse cx="220" cy="174" rx="134" ry="106" fill="var(--color-forest)" />
            <ellipse cx="220" cy="174" rx="116" ry="90" fill="none" stroke="var(--color-mint)" strokeOpacity=".35" />
          </svg>
          <span className="council-table-caption">Mesa del<br />consejo</span>
          {seats.map((seat) => {
            const taken = SEATED.includes(seat.state.kind);
            const sellable = seat.state.kind === "available";
            return (
              <button type="button" key={seat.key} data-seat={seat.key}
                className={`council-seat ${taken ? "" : "council-seat-free"} ${seat.state.kind === "setup" ? "council-seat-setup" : ""}`}
                onClick={() => (taken ? focusSeat(seat.key) : sellable ? go("/plan") : focusSeat(seat.key))}
                aria-label={taken ? `Escuchar a ${seat.name}` : sellable ? `Silla libre: sumar a ${seat.name}` : `Silla de ${seat.name}, próximamente`}>
                <Portrait seat={seat} />
                <span>{taken ? seat.name : sellable ? "Silla libre" : "Próximamente"}</span>
              </button>
            );
          })}
        </div>

        <div className="council-brief">
          <header>
            <h2 id="council-session">La sesión del consejo</h2>
            <p>{weekly ? `Semana del ${shortDate(weekly.week.start)} al ${shortDate(weekly.week.end)}` : "Esta semana"} · {working === 1 ? "1 gato en la mesa" : `${working} gatos en la mesa`}</p>
          </header>
          {activity === undefined ? (
            <div className="space-y-3 p-5" aria-busy="true" aria-label="El consejo se está reuniendo">
              {[0, 1, 2].map((n) => <div key={n} className="h-16 animate-pulse rounded-xl bg-surface-subtle motion-reduce:animate-none" />)}
            </div>
          ) : (
            <ul>
              {session.map((seat) => (
                <li key={seat.key} id={`consejo-${seat.key}`} tabIndex={-1}
                  className={seat.advice.tone === "free" ? "council-free" : ""}>
                  <article className="council-advice">
                    <Portrait seat={seat} />
                    <div className="min-w-0 flex-1">
                      <h3>{seat.name}</h3>
                      <p>{seat.advice.text}</p>
                      {peopleBy.has(seat.key) && people && (
                        <p className="council-today">Últimos {people.days} días: {peopleLine(peopleBy.get(seat.key)!).replace(/^N/, "n")}</p>
                      )}
                      <div className="council-links">
                        {seat.state.kind === "active" && seat.detail ? (
                          <a href={seat.detail} onClick={open(seat.detail)} aria-label={`Ver lo que hizo ${seat.name}`}>
                            Ver lo que hizo <span aria-hidden="true">→</span>
                          </a>
                        ) : seat.advice.action ? (
                          <a href={seat.advice.action.path} onClick={open(seat.advice.action.path)}>
                            {seat.advice.action.label} <span aria-hidden="true">→</span>
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <CouncilTrend activity={activity} />
        <PeopleReport report={people} members={weekly?.team.members ?? null} seats={seats} />
      </div>
    </div>
  );
}

const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}/${iso.slice(5, 7)}`;

function Portrait({ seat }: { seat: Seat }) {
  if (!SEATED.includes(seat.state.kind)) {
    return (
      <span className="council-portrait council-portrait-empty" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 19V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M7 19h18v4H7zM10 23v4m12-4v4" />
        </svg>
      </span>
    );
  }
  return (
    <span className="council-portrait">
      <img src={agentLogo(seat.key)} alt="" width={52} height={52} decoding="async" />
    </span>
  );
}

/** What the council looks at: the last 7 days against the 7 before, for each active metric. */
function CouncilTrend({ activity }: { activity: CompanyActivity | null | undefined }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-card" aria-labelledby="council-trend">
      <header className="border-b border-line px-5 py-3.5">
        <h2 id="council-trend" className="text-xl text-ink">Lo que revisa el consejo</h2>
        <p className="text-sm text-ink-muted">Los últimos 7 días frente a los 7 anteriores.</p>
      </header>
      {activity === undefined ? (
        <div className="h-48 animate-pulse bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando la tendencia" />
      ) : activity === null ? (
        <p className="px-5 py-6 text-sm text-ink-muted">No pudimos cargar la tendencia. Vuelve a intentarlo en unos minutos.</p>
      ) : (
        <TrendBody activity={activity} />
      )}
    </section>
  );
}

function TrendBody({ activity }: { activity: CompanyActivity }) {
  const metrics = buildSeriesMetrics(activity);
  if (!metrics.some((metric) => metric.hasData)) {
    return (
      <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-muted">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-subtle text-forest"><Icon name="chart" /></span>
        Todavía no hay movimiento en los últimos 14 días para comparar.
      </div>
    );
  }
  return (
    <div className="divide-y divide-line">
      {metrics.map((metric) => <TrendRow key={metric.key} metric={metric} activity={activity} />)}
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#cfe3dc]" />7 días anteriores</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-forest" />Últimos 7 días</span>
      </p>
    </div>
  );
}

function TrendRow({ metric, activity }: { metric: TrendMetric; activity: CompanyActivity }) {
  const pick = metric.key === "invoices" ? (d: CompanyActivity["series"][number]) => d.invoices
    : metric.key === "sales" ? (d: CompanyActivity["series"][number]) => d.salesCents
    : (d: CompanyActivity["series"][number]) => d.collectionsCents;
  const { current, previous } = weekOverWeek(activity.series, pick);
  const change = percentChange(current, previous);
  const format = (value: number) => metric.key === "invoices" ? `${value} ${value === 1 ? "comprobante" : "comprobantes"}` : soles(value);
  const values = metric.values;
  const max = Math.max(...values, 1);
  const width = 280;
  const height = 64;
  const gap = 4;
  const bar = (width - gap * (values.length - 1)) / values.length;
  const label = `${metric.label}: ${format(current)} en los últimos 7 días${change === null ? "" : `, ${Math.abs(change)} % ${change >= 0 ? "más" : "menos"} que en los 7 anteriores`}.`;
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-ink">{metric.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-base font-bold tabular-nums text-forest">{format(current)}</span>
          {change !== null && (
            <span className={`chip border text-xs ${change >= 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change)} %
            </span>
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="mt-3 h-16 w-full">
        {values.map((value, index) => {
          const h = value > 0 ? Math.max(3, (value / max) * (height - 4)) : 2;
          return (
            <rect key={index} x={index * (bar + gap)} y={height - h} width={bar} height={h} rx={2}
              fill={index >= values.length - 7 ? "var(--color-forest)" : "#cfe3dc"} />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
        <span>{shortDate(activity.series[0].date)}</span>
        <span>{previous ? `7 días anteriores: ${format(previous)}` : "Sin datos de la semana anterior"}</span>
        <span>{shortDate(activity.series[activity.series.length - 1].date)}</span>
      </div>
    </div>
  );
}

/** Who talked to each cat in the last 30 days (the operator's report). */
function PeopleReport({ report, members, seats }: {
  report: { days: number; rows: PeopleRow[] } | null;
  members: number | null;
  seats: Seat[];
}) {
  const name = (key: AgentKey) => seats.find((seat) => seat.key === key)?.name ?? key;
  const max = Math.max(1, ...(report?.rows.map((row) => row.team + (row.customers ?? 0)) ?? []));
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-card" aria-labelledby="council-people">
      <header className="border-b border-line px-5 py-3.5">
        <h2 id="council-people" className="text-xl text-ink">Quién habla con tus gatos</h2>
        <p className="text-sm text-ink-muted">
          {report ? `Últimos ${report.days} días` : "Últimos 30 días"}{members ? ` · tu equipo tiene ${members === 1 ? "1 persona" : `${members} personas`}` : ""}.
        </p>
      </header>
      {!report ? (
        <p className="px-5 py-6 text-sm text-ink-muted">Todavía no tenemos este informe para tu empresa. Vuelve más tarde.</p>
      ) : !report.rows.length ? (
        <p className="px-5 py-6 text-sm text-ink-muted">Cuando tengas gatos en la mesa, aquí verás quién les habla.</p>
      ) : (
        <ul className="divide-y divide-line">
          {report.rows.map((row) => {
            const team = (row.team / max) * 100;
            const customers = ((row.customers ?? 0) / max) * 100;
            return (
              <li key={row.agent} className="flex items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mint">
                  <img src={agentLogo(row.agent)} alt="" width={28} height={28} className="h-7 w-7 mix-blend-multiply" decoding="async" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-sm font-semibold text-ink">{name(row.agent)}</span>
                    <span className="text-xs text-ink-muted">{peopleLine(row)}</span>
                  </div>
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                    <span className="h-full bg-forest" style={{ width: `${team}%` }} />
                    <span className="h-full bg-amber-500" style={{ width: `${customers}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {report?.rows.some((row) => row.customers !== undefined) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-forest" />Tu equipo</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Tus clientes</span>
        </p>
      )}
    </section>
  );
}
