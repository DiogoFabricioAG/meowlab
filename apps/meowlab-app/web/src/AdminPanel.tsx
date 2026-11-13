import { useEffect, useState } from "react";
import { fetchJson } from "./auth-client";

type AdminMetrics = {
  generatedAt: string;
  timeZone: string;
  accounts: {
    total: number;
    newLast7Days: number;
    newLast30Days: number;
    withGoogle: number;
    withPassword: number;
    activeLast7Days: number;
  };
  signupsByDay: Array<{ day: string; count: number }>;
  whatsappLinked: number | null;
  billing: { live: number; paying: number; monthlyRevenueCents: number; paymentsLast30Days: number; revenueLast30DaysCents: number } | null;
};

const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("es-PE", options);

const percent = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)} %` : "—");

export function AdminPanel() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void fetchJson<AdminMetrics>("/api/admin/metrics").then((value) => (value ? setMetrics(value) : setFailed(true)));
  }, []);

  if (failed) {
    return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos cargar las métricas.</p>;
  }
  if (!metrics) return <p className="text-ink-muted" aria-busy="true">Cargando métricas…</p>;

  const { accounts } = metrics;
  const tiles = [
    { label: "Cuentas", value: accounts.total, note: `${accounts.newLast30Days} nuevas en 30 días` },
    { label: "Nuevas en 7 días", value: accounts.newLast7Days, note: "Registros de la última semana" },
    { label: "Activas en 7 días", value: accounts.activeLast7Days, note: "Con sesión usada en la semana" },
    {
      label: "WhatsApp vinculado",
      value: metrics.whatsappLinked ?? "—",
      note: metrics.whatsappLinked === null ? "Disponible al activar la vinculación" : percent(metrics.whatsappLinked, accounts.total),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Negocio</h2>
        <p className="text-ink-muted">
          Cuentas del portal. Sólo totales, sin datos personales · Actualizado el{" "}
          {new Date(metrics.generatedAt).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-line bg-white p-5 shadow-soft">
            <dt className="text-sm font-semibold text-ink-muted">{tile.label}</dt>
            <dd className="mt-1 font-title text-4xl font-bold tracking-tight text-ink tabular-nums">{tile.value}</dd>
            <dd className="mt-1 text-sm text-ink-muted">{tile.note}</dd>
          </div>
        ))}
      </dl>

      {metrics.billing && (
        <section className="space-y-3" aria-labelledby="billing-title">
          <h3 id="billing-title" className="text-lg font-bold text-ink">Cobros</h3>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Ingreso mensual recurrente", value: `S/ ${(metrics.billing.monthlyRevenueCents / 100).toFixed(2)}`, note: "Suscripciones activas y al día, con IGV" },
              { label: "Clientes al día", value: metrics.billing.paying, note: `${metrics.billing.live} suscripciones vivas` },
              { label: "Cobrado en 30 días", value: `S/ ${(metrics.billing.revenueLast30DaysCents / 100).toFixed(2)}`, note: `${metrics.billing.paymentsLast30Days} pagos` },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-line bg-white p-5 shadow-soft">
                <dt className="text-sm font-semibold text-ink-muted">{tile.label}</dt>
                <dd className="mt-1 font-title text-3xl font-bold tracking-tight text-ink tabular-nums">{tile.value}</dd>
                <dd className="mt-1 text-sm text-ink-muted">{tile.note}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <SignupsChart days={metrics.signupsByDay} />

      <section className="rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="providers-title">
        <h3 id="providers-title" className="text-lg font-bold text-ink">Cómo entran</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ProviderRow label="Google" users={accounts.withGoogle} total={accounts.total} />
          <ProviderRow label="Correo y contraseña" users={accounts.withPassword} total={accounts.total} />
        </div>
      </section>
    </div>
  );
}

function ProviderRow({ label, users, total }: { label: string; users: number; total: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-xl bg-surface-subtle px-4 py-3">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums">
        <strong className="font-title text-2xl font-bold text-ink">{users}</strong>{" "}
        <span className="text-sm text-ink-muted">{percent(users, total)}</span>
      </span>
    </div>
  );
}

const HEIGHT = 160;
const BAR = 18;
const SLOT = 32;

function SignupsChart({ days }: { days: AdminMetrics["signupsByDay"] }) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = Math.max(1, ...days.map((day) => day.count));
  const width = days.length * SLOT;
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const peak = days.reduce((best, day, index) => (day.count > days[best].count ? index : best), 0);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  const y = (value: number) => HEIGHT - (value / max) * HEIGHT;
  const shown = active ?? null;

  return (
    <section className="rounded-3xl border border-line bg-white p-6 shadow-card" aria-labelledby="signups-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="signups-title" className="text-lg font-bold text-ink">Registros por día</h3>
          <p className="text-sm text-ink-muted">Últimos 30 días · {total} en total</p>
        </div>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="btn-secondary px-3 py-2 text-sm">
          {showTable ? "Ver gráfico" : "Ver tabla"}
        </button>
      </div>

      {showTable ? (
        <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-subtle text-left text-ink-2">
              <tr>
                <th className="px-4 py-2 font-semibold">Día</th>
                <th className="px-4 py-2 text-right font-semibold">Registros</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((day) => (
                <tr key={day.day} className="border-t border-line">
                  <td className="px-4 py-2 text-ink-2">{dayLabel(day.day, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{day.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-6 flex gap-2">
          <div className="relative w-6 shrink-0 text-right text-xs text-ink-muted" style={{ height: HEIGHT }} aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: y(tick) }}>
                {tick}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="relative" style={{ width }}>
              <svg
                width={width}
                height={HEIGHT + 24}
                role="img"
                aria-label={`Registros por día en los últimos 30 días: ${total} en total; el máximo fue ${days[peak]?.count ?? 0} el ${days[peak] ? dayLabel(days[peak].day, { day: "numeric", month: "long" }) : ""}.`}
                onMouseLeave={() => setActive(null)}
              >
                {ticks.map((tick) => (
                  <line key={tick} x1={0} x2={width} y1={y(tick)} y2={y(tick)} stroke="#e8ece9" strokeWidth={1} />
                ))}
                {days.map((day, index) => {
                  const x = index * SLOT + (SLOT - BAR) / 2;
                  const h = HEIGHT - y(day.count);
                  const r = Math.min(4, h / 2);
                  return (
                    <g key={day.day}>
                      {day.count > 0 && (
                        <path
                          d={`M${x},${HEIGHT} V${HEIGHT - h + r} Q${x},${HEIGHT - h} ${x + r},${HEIGHT - h} H${x + BAR - r} Q${x + BAR},${HEIGHT - h} ${x + BAR},${HEIGHT - h + r} V${HEIGHT} Z`}
                          fill="#0c493c"
                          opacity={shown === null || shown === index ? 1 : 0.35}
                        />
                      )}
                      {((index % 7 === 0 && index < days.length - 3) || index === days.length - 1) && (
                        <text x={index * SLOT + SLOT / 2} y={HEIGHT + 16} textAnchor="middle" fontSize={11} fill="#46544f">
                          {dayLabel(day.day, { day: "numeric", month: "short" })}
                        </text>
                      )}
                      <rect
                        x={index * SLOT}
                        y={0}
                        width={SLOT}
                        height={HEIGHT}
                        fill="transparent"
                        onMouseEnter={() => setActive(index)}
                        onFocus={() => setActive(index)}
                        onBlur={() => setActive(null)}
                        tabIndex={0}
                        aria-label={`${dayLabel(day.day, { day: "numeric", month: "long" })}: ${day.count} registros`}
                      />
                    </g>
                  );
                })}
              </svg>
              {shown !== null && days[shown] && (
                <div
                  className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-3 py-2 text-sm text-white shadow-elevated"
                  style={{ left: shown * SLOT + SLOT / 2, top: Math.max(0, y(days[shown].count) - 8) }}
                  role="status"
                >
                  <div className="font-semibold tabular-nums">{days[shown].count} registros</div>
                  <div className="text-xs text-ink-faint">{dayLabel(days[shown].day, { weekday: "long", day: "numeric", month: "long" })}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
