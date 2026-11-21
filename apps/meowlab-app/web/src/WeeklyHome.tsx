import type { Me, Membership } from "./auth-client";
import { AGENTS, agentLogo, agentState, type CatalogAgent, type Weekly } from "./agents";
import { agentPulse, attentionItems, PULSE_LABEL, type AgentPulse, type AttentionItem } from "./attention";
import { HomeActivity } from "./HomeActivity";
import { Icon } from "./icons";
import { PageHeader } from "./PageHeader";

const soles = (value: number) =>
  `S/ ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const longDay = (iso: string) => {
  const text = new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const greeting = () => {
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Lima" }));
  if (hour < 5 || hour >= 19) return "Buenas noches";
  return hour < 12 ? "Buenos días" : "Buenas tardes";
};

/** «+12 % frente a la semana pasada», or null when there is nothing to compare with. */
function change(current: number, previous: number): { text: string; up: boolean } | null {
  if (previous <= 0) return null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { text: "Igual que la semana pasada", up: true };
  return { text: `${percent > 0 ? "+" : ""}${percent} % frente a la semana pasada`, up: percent > 0 };
}

type Kpi = { key: string; label: string; value: string; note: string | null; tone: "up" | "down" | "plain" };

/** Up to four figures of the week, each with its comparison or context. Real data only. */
function weekFigures(weekly: Weekly): Kpi[] {
  const figures: Kpi[] = [];
  const invoicing = weekly.invoicing && weekly.invoicing.status === "ok" ? weekly.invoicing : null;
  if (weekly.sales?.enabled) {
    const sales = weekly.sales;
    figures.push({ key: "sales", label: "Ventas de la semana", value: soles(sales.weekTotalCents / 100), tone: "plain",
      note: `${sales.weekCount} ${sales.weekCount === 1 ? "venta" : "ventas"} · ${sales.weekQuotes} ${sales.weekQuotes === 1 ? "cotización" : "cotizaciones"}` });
  }
  if (invoicing) {
    const delta = change(Number(invoicing.totalPen), Number(invoicing.previousTotalPen));
    figures.push({ key: "invoicing", label: "Facturado esta semana", value: soles(Number(invoicing.totalPen)),
      note: delta?.text ?? `${invoicing.documents} ${invoicing.documents === 1 ? "comprobante" : "comprobantes"} aceptados`,
      tone: delta ? (delta.up ? "up" : "down") : "plain" });
  }
  if (weekly.collections?.enabled) {
    const collections = weekly.collections;
    figures.push({ key: "collections", label: "Te deben", value: soles(collections.owedCents / 100),
      note: collections.lateCount ? `${collections.lateCount} ${collections.lateCount === 1 ? "deuda vencida" : "deudas vencidas"}` : "Todo al día",
      tone: collections.lateCount ? "down" : "up" });
  }
  if (weekly.support?.enabled) {
    const support = weekly.support;
    figures.push({ key: "support", label: "Clientes atendidos", value: String(support.customers), tone: "plain",
      note: `${support.answered} ${support.answered === 1 ? "resuelto" : "resueltos"} sin ti` });
  }
  if (figures.length < 4) {
    const delta = change(weekly.team.messages, weekly.team.previousMessages);
    figures.push({ key: "team", label: "Mensajes de tu equipo", value: String(weekly.team.messages),
      note: delta?.text ?? `${weekly.team.activePeople} ${weekly.team.activePeople === 1 ? "persona activa" : "personas activas"}`,
      tone: delta ? (delta.up ? "up" : "down") : "plain" });
  }
  return figures.slice(0, 4);
}

const PULSE_DOT: Record<AgentPulse, string> = {
  needs: "bg-amber-500",
  working: "bg-forest",
  quiet: "bg-line-mint",
};

/**
 * «Inicio» as the owner's command centre: the week in four figures, what needs her today, and
 * how each of her cats is doing. Approvals still happen in the chat; each item opens its agent.
 */
export function WeeklyHome({ me, company, weekly, failed, catalog, go }: {
  me: Me;
  company: Membership;
  weekly: Weekly | null;
  failed: boolean;
  catalog: CatalogAgent[] | null;
  go: (path: string) => void;
}) {
  const firstName = me.user.name.trim().split(/\s+/)[0] || "";
  const active = AGENTS.map((agent) => ({ agent, state: agentState(agent.key, company, weekly, catalog) }))
    .filter((entry) => entry.state.kind === "active");
  const attention = attentionItems(weekly);
  const invoicing = weekly?.invoicing && weekly.invoicing.status === "ok" ? weekly.invoicing : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={weekly ? longDay(weekly.today) : "Hoy"}
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        subtitle={`Lo que hicieron tus agentes para ${company.name}.`}
        actions={
          weekly ? (
            <p className="text-sm text-ink-muted">
              Semana del {weekly.week.start.slice(8, 10)}/{weekly.week.start.slice(5, 7)} al {weekly.week.end.slice(8, 10)}/{weekly.week.end.slice(5, 7)}
            </p>
          ) : undefined
        }
      />

      {!weekly && !failed && (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando">
          <div className="h-28 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
          <div className="h-48 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
        </div>
      )}
      {failed && <p className="rounded-2xl border border-line bg-white px-5 py-4 text-ink-muted">No pudimos cargar lo de hoy. Vuelve a intentarlo en unos minutos.</p>}

      {weekly && active.length === 0 && (
        <section className="rounded-2xl border border-line-mint bg-mint-light px-6 py-6">
          <h2 className="text-2xl text-ink">Todavía ningún agente trabaja para {company.name}</h2>
          <p className="mt-1 text-ink-muted">Suma tu primer gato y verás aquí lo que hace por ti cada día.</p>
          <button type="button" onClick={() => go("/agentes")} className="btn-primary mt-4">Ver los agentes que puedes sumar</button>
        </section>
      )}

      {weekly && active.length > 0 && (
        <>
          <section aria-label="Tu semana">
            <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-white lg:grid-cols-4">
              {weekFigures(weekly).map((figure, index) => (
                <div key={figure.key}
                  className={`min-w-0 px-5 py-4 ${index % 2 === 1 ? "border-l border-line" : ""} ${index >= 2 ? "border-t border-line lg:border-t-0" : ""} ${index >= 1 ? "lg:border-l" : ""}`}>
                  <dt className="text-sm text-ink-muted">{figure.label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums sm:text-[28px]">{figure.value}</dd>
                  {figure.note && (
                    <dd className={`mt-0.5 text-sm font-semibold ${figure.tone === "down" ? "text-red-700" : figure.tone === "up" ? "text-forest" : "text-ink-muted"}`}>
                      {figure.note}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
            {invoicing?.partial && <p className="mt-2 text-sm text-ink-muted">Semana con muchos comprobantes: el total considera los primeros 200.</p>}
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="attention-title">
              <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <h2 id="attention-title" className="text-xl text-ink">Para atender</h2>
                <span className="text-sm text-ink-muted">{attention.length ? `${attention.length} ${attention.length === 1 ? "pendiente" : "pendientes"}` : "Al día"}</span>
              </header>
              {attention.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-6 text-ink-muted">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint text-forest"><Icon name="check" /></span>
                  Todo al día: tus agentes no te necesitan por ahora.
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {attention.map((item) => <AttentionRow key={item.key} item={item} go={go} />)}
                </ul>
              )}
              <p className="border-t border-line bg-surface-subtle px-5 py-2.5 text-xs text-ink-muted">Las aprobaciones se hacen en el chat, donde el gato te preguntó.</p>
            </section>

            <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="cats-title">
              <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <h2 id="cats-title" className="text-xl text-ink">Tus gatos hoy</h2>
                <button type="button" onClick={() => go("/agentes")} className="text-sm font-semibold text-forest underline-offset-4 hover:underline">Ver todos</button>
              </header>
              <ul className="divide-y divide-line">
                {active.map(({ agent, state }) => {
                  const pulse = agentPulse(agent.key, weekly);
                  return (
                    <li key={agent.key}>
                      <button type="button" onClick={() => go(agent.detail ?? "/agentes")}
                        className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-subtle">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint">
                          <img src={agentLogo(agent.key)} alt="" width={32} height={32} className="h-8 w-8 mix-blend-multiply" decoding="async" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2">
                            <span className="font-semibold text-ink">{agent.name}</span>
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${PULSE_DOT[pulse]}`} />{PULSE_LABEL[pulse]}
                            </span>
                          </span>
                          <span className="block text-sm leading-snug text-ink-muted">{state.kind === "active" ? state.today : ""}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-line bg-surface-subtle px-5 py-2.5 text-xs text-ink-muted">
                {weekly.team.messagesToday
                  ? `Hoy tu equipo les escribió ${weekly.team.messagesToday} ${weekly.team.messagesToday === 1 ? "mensaje" : "mensajes"}.`
                  : "Hoy nadie de tu equipo les escribió."}
              </p>
            </section>
          </div>

          <HomeActivity companyId={company.id} />
        </>
      )}

      {!me.whatsapp.linked && (
        <button type="button" onClick={() => go("/ajustes")}
          className="flex w-full items-center justify-between gap-4 rounded-2xl border border-line-mint bg-white px-5 py-4 text-left hover:border-forest">
          <span>
            <span className="block font-semibold text-ink">Vincula tu WhatsApp</span>
            <span className="block text-sm text-ink-2">Así tus agentes te reconocen y lo que hagas en el chat aparece aquí.</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-forest">Ir a Configuración</span>
        </button>
      )}

      {company.role === "owner" && (
        <button type="button" onClick={() => go("/ajustes/equipo")}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-left hover:border-forest">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint text-forest"><Icon name="users" /></span>
          <span>
            <span className="block font-semibold text-ink">Invita a tu equipo</span>
            <span className="block text-sm text-ink-muted">Quien venda contigo puede usar a tus agentes desde su propio WhatsApp.</span>
          </span>
        </button>
      )}
    </div>
  );
}

const TONE: Record<AttentionItem["tone"], { icon: "alert" | "star" | "clock"; box: string }> = {
  action: { icon: "clock", box: "bg-mint text-forest" },
  warning: { icon: "alert", box: "bg-amber-50 text-amber-700" },
  opportunity: { icon: "star", box: "bg-mint-subtle text-forest" },
};

function AttentionRow({ item, go }: { item: AttentionItem; go: (path: string) => void }) {
  const tone = TONE[item.tone];
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone.box}`}><Icon name={tone.icon} /></span>
        <div className="min-w-0">
          <div className="font-semibold leading-snug text-ink">{item.title}</div>
          <div className="text-sm text-ink-muted">{item.text}</div>
        </div>
      </div>
      {item.action && ("href" in item.action ? (
        <a href={item.action.href} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-10 shrink-0 items-center gap-1 self-start rounded-[10px] border border-line px-3.5 text-sm font-semibold text-forest hover:border-forest sm:self-center">
          {item.action.label} <Icon name="external" className="h-4 w-4" /><span className="sr-only">(se abre en otra pestaña)</span>
        </a>
      ) : (
        <button type="button" onClick={() => go((item.action as { path: string }).path)}
          className="inline-flex min-h-10 shrink-0 items-center self-start rounded-[10px] bg-forest px-3.5 text-sm font-semibold text-white hover:bg-forest-hover sm:self-center">
          {item.action.label}
        </button>
      ))}
    </li>
  );
}
