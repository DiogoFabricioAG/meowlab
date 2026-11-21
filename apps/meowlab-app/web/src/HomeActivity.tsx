import { useEffect, useState } from "react";
import { AGENTS, agentLogo, type ActivityDay, type ActivityEvent, type CompanyActivity } from "./agents";
import { fetchJson } from "./auth-client";
import { Icon } from "./icons";

export type TrendMetric = {
  key: "invoices" | "sales" | "collections";
  label: string;
  color: string;
  totalText: string;
  values: number[];
  points: string;
  hasData: boolean;
};

const soles = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Normalizes a numeric series onto an SVG polyline (`0..width` × `pad..height-pad`). */
export function normalizeSparkline(values: readonly number[], width = 280, height = 64, pad = 6): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 0);
  const usableHeight = Math.max(1, height - pad * 2);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = Math.round(index * step * 10) / 10;
      const ratio = max > 0 ? value / max : 0;
      const y = Math.round((height - pad - ratio * usableHeight) * 10) / 10;
      return `${x},${y}`;
    })
    .join(" ");
}

/** Builds only the metrics whose cat is active for the company. */
export function buildSeriesMetrics(activity: CompanyActivity): TrendMetric[] {
  const days: readonly ActivityDay[] = activity.series;
  const metrics: TrendMetric[] = [];

  if (activity.active.invoicing) {
    const values = days.map((day) => day.invoices);
    const total = values.reduce((sum, v) => sum + v, 0);
    metrics.push({
      key: "invoices",
      label: "Comprobantes emitidos",
      color: "#0c493c",
      totalText: `${total} ${total === 1 ? "comprobante" : "comprobantes"}`,
      values,
      points: normalizeSparkline(values),
      hasData: total > 0,
    });
  }

  if (activity.active.sales) {
    const values = days.map((day) => day.salesCents);
    const total = values.reduce((sum, v) => sum + v, 0);
    metrics.push({
      key: "sales",
      label: "Monto vendido",
      color: "#12594a",
      totalText: soles(total),
      values,
      points: normalizeSparkline(values),
      hasData: total > 0,
    });
  }

  if (activity.active.collections) {
    const values = days.map((day) => day.collectionsCents);
    const total = values.reduce((sum, v) => sum + v, 0);
    metrics.push({
      key: "collections",
      label: "Cobros registrados",
      color: "#b45309",
      totalText: soles(total),
      values,
      points: normalizeSparkline(values),
      hasData: total > 0,
    });
  }

  return metrics;
}

/** Formats an ISO instant in Lima time: `HH:MM` when today, `DD/MM · HH:MM` otherwise. */
export function formatActivityWhen(iso: string, todayLima: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const limaInstant = new Date(date.getTime() - 5 * 3_600_000);
  const limaDay = limaInstant.toISOString().slice(0, 10);
  const hhmm = limaInstant.toISOString().slice(11, 16);
  return limaDay === todayLima ? hhmm : `${shortDay(limaDay)} · ${hhmm}`;
}

const limaParts = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const lima = new Date(date.getTime() - 5 * 3_600_000).toISOString();
  return { day: lima.slice(0, 10), time: lima.slice(11, 16) };
};

/** «Hoy», «Ayer» or «lunes 16 nov.», for the day headers of the activity list. */
export function activityDayLabel(day: string, todayLima: string): string {
  const today = new Date(`${todayLima}T12:00:00Z`);
  const yesterday = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (day === todayLima) return "Hoy";
  if (day === yesterday) return "Ayer";
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export type ActivityGroup = { day: string; label: string; events: Array<ActivityEvent & { time: string }> };

/** Events newest first, grouped by Lima day. */
export function groupActivityByDay(events: readonly ActivityEvent[], todayLima: string): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const event of [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())) {
    const parts = limaParts(event.at);
    if (!parts) continue;
    let group = groups[groups.length - 1];
    if (!group || group.day !== parts.day) {
      group = { day: parts.day, label: activityDayLabel(parts.day, todayLima), events: [] };
      groups.push(group);
    }
    group.events.push({ ...event, time: parts.time });
  }
  return groups;
}

const FIRST_EVENTS = 8;

export function HomeActivity({ companyId }: { companyId: string }) {
  const [activity, setActivity] = useState<CompanyActivity | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setActivity(null);
    setFailed(false);
    void fetchJson<CompanyActivity>(`/api/companies/${encodeURIComponent(companyId)}/activity`)
      .then((value) => {
        if (!active) return;
        if (value) setActivity(value);
        else setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [companyId]);

  if (!activity && !failed) {
    return (
      <div className="h-56 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando actividad" />
    );
  }

  if (failed || !activity) {
    return (
      <p className="rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-muted">
        No pudimos cargar la actividad reciente. Vuelve a intentarlo en unos minutos.
      </p>
    );
  }

  // The trend lives in «Tus agentes» (the council): Inicio is today and what is pending.
  return (
    <div>
      <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="activity-title">
        <header className="border-b border-line px-5 py-3.5">
          <h2 id="activity-title" className="text-xl text-ink">Actividad reciente</h2>
          <p className="text-sm text-ink-muted">Lo último que hicieron tus gatos.</p>
        </header>

        {activity.events.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-muted">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint text-forest">
              <Icon name="clock" />
            </span>
            Todavía no hay actividad registrada de tus gatos. Cuando trabajen por WhatsApp, aparecerá aquí.
          </div>
        ) : (
          <>
            <div className="divide-y divide-line">
              {groupActivityByDay(showAll ? activity.events : activity.events.slice(0, FIRST_EVENTS), activity.today).map((group) => (
                <section key={group.day} aria-label={group.label} className="px-5 py-3">
                  <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{group.label}</h3>
                  <ul className="space-y-1">
                    {group.events.map((event) => <ActivityRow key={event.id} event={event} />)}
                  </ul>
                </section>
              ))}
            </div>
            {activity.events.length > FIRST_EVENTS && (
              <button type="button" onClick={() => setShowAll((value) => !value)}
                className="w-full border-t border-line px-5 py-3 text-sm font-semibold text-forest hover:bg-surface-subtle">
                {showAll ? "Ver menos" : `Ver las ${activity.events.length} acciones`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const AGENT_NAMES = AGENTS.map((agent) => agent.name);

function ActivityRow({ event }: { event: ActivityEvent & { time: string } }) {
  // The cat's name in bold and the rest as a sentence: «Invoice Cat · emitió la factura F001-…».
  const name = AGENT_NAMES.find((candidate) => event.text.startsWith(`${candidate} `));
  const rest = name ? event.text.slice(name.length + 1) : event.text;
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mint">
        <img src={agentLogo(event.agent)} alt="" width={28} height={28} className="h-7 w-7 mix-blend-multiply" decoding="async" />
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug text-ink-2">
        {name && <span className="font-semibold text-ink">{name} </span>}
        {rest}
      </p>
      <time dateTime={event.at} className="shrink-0 pt-0.5 text-xs tabular-nums text-ink-muted">{event.time}</time>
    </li>
  );
}
