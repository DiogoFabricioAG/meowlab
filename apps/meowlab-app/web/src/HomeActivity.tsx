import { useEffect, useState } from "react";
import { agentLogo, type ActivityDay, type ActivityEvent, type CompanyActivity } from "./agents";
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

export function HomeActivity({ companyId }: { companyId: string }) {
  const [activity, setActivity] = useState<CompanyActivity | null>(null);
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" aria-busy="true" aria-label="Cargando actividad">
        <div className="h-56 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
        <div className="h-56 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
      </div>
    );
  }

  if (failed || !activity) {
    return (
      <p className="rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-muted">
        No pudimos cargar la tendencia de los últimos 14 días ni la actividad reciente. Vuelve a intentarlo en unos minutos.
      </p>
    );
  }

  const metrics = buildSeriesMetrics(activity);
  const hasAnyTrend = metrics.some((metric) => metric.hasData);
  const rangeLabel = activity.series.length
    ? `${shortDay(activity.series[0].date)} al ${shortDay(activity.series[activity.series.length - 1].date)}`
    : "Últimos 14 días";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="trend-title">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="trend-title" className="text-xl text-ink">Tendencia (14 días)</h2>
          <span className="text-sm text-ink-muted">{rangeLabel}</span>
        </header>

        {metrics.length === 0 || !hasAnyTrend ? (
          <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-muted">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-subtle text-forest">
              <Icon name="chart" />
            </span>
            Todavía no hay movimiento en los últimos 14 días para tus gatos activos.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {metrics.map((metric) => (
              <div key={metric.key} className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: metric.color }} />
                    <span className="text-sm font-semibold text-ink">{metric.label}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-forest">{metric.totalText}</span>
                </div>
                <svg
                  viewBox="0 0 280 64"
                  role="img"
                  aria-label={`${metric.label}: ${metric.totalText} en los últimos 14 días`}
                  className="mt-2.5 h-16 w-full overflow-visible"
                >
                  <line x1="0" y1="58" x2="280" y2="58" stroke="#e8ece9" strokeWidth="1" />
                  <polyline
                    fill="none"
                    stroke={metric.color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={metric.points}
                  />
                </svg>
                <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
                  <span>{shortDay(activity.series[0].date)}</span>
                  <span>{shortDay(activity.series[activity.series.length - 1].date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="activity-title">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id="activity-title" className="text-xl text-ink">Actividad reciente</h2>
          <span className="text-sm text-ink-muted">
            {activity.events.length ? `${activity.events.length} ${activity.events.length === 1 ? "acción" : "acciones"}` : "Sin registros"}
          </span>
        </header>

        {activity.events.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-6 text-sm text-ink-muted">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint text-forest">
              <Icon name="clock" />
            </span>
            Todavía no hay actividad registrada de tus gatos. Cuando trabajen por WhatsApp, aparecerá aquí.
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {activity.events.map((event) => (
              <ActivityRow key={event.id} event={event} today={activity.today} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ActivityRow({ event, today }: { event: ActivityEvent; today: string }) {
  const when = formatActivityWhen(event.at, today);
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-mint">
        <img
          src={agentLogo(event.agent)}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 mix-blend-multiply"
          decoding="async"
        />
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug text-ink">
        <span className="font-semibold tabular-nums text-forest">{when}</span>
        {" · "}
        <span>{event.text}</span>
      </p>
    </li>
  );
}
