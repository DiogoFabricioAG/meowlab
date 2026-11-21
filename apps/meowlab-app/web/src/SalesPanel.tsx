import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "./api";
import { fetchJson, type Membership } from "./auth-client";
import { PageHeader } from "./PageHeader";

type SalesView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    catName: string | null;
    month: string;
    goalTargetCents: number | null;
    monthTotalCents: number;
    monthCount: number;
    daysInMonth: number;
    currentDay: number | null;
  };

const soles = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS_ES[Number(m) - 1] ?? ym} ${y}`;
};

/** Sales Cat's card (ADR-0011, phase 3): monthly goal progress and custom cat name per company. */
export function SalesPanel({ company, onBack, onSaved }: {
  company: Membership;
  onBack: () => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<SalesView | null>(null);
  const [failed, setFailed] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setFailed(false);
    void fetchJson<SalesView>(`/api/companies/${encodeURIComponent(company.id)}/sales`)
      .then((view) => {
        if (!view) {
          setFailed(true);
          return;
        }
        setData(view);
        if (view.enabled) {
          setGoalInput(view.goalTargetCents ? String(view.goalTargetCents / 100) : "");
          setNameInput(view.catName ?? "");
        }
      })
      .catch(() => setFailed(true));
  }, [company.id]);

  async function saveSettings(body: { goalTargetCents?: number | null; catName?: string | null; month?: string }, okText: string) {
    setMessage(null);
    setError(null);
    const res = await apiFetch(`/api/companies/${encodeURIComponent(company.id)}/sales/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      if (payload?.error === "invalid_cat_name") {
        setError("El nombre debe tener entre 2 y 20 caracteres, sin enlaces ni nombres de otros gatos o MeowLab.");
      } else {
        setError("No pudimos guardar el cambio. Revisa los datos e inténtalo otra vez.");
      }
      return;
    }
    const updated = await res.json() as SalesView;
    setData(updated);
    if (updated.enabled) {
      setGoalInput(updated.goalTargetCents ? String(updated.goalTargetCents / 100) : "");
      setNameInput(updated.catName ?? "");
    }
    setMessage(okText);
    onSaved?.();
  }

  async function onGoalSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(goalInput.replace(/,/g, ".").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Escribe una meta mensual mayor a S/ 0.");
      return;
    }
    setSavingGoal(true);
    try {
      await saveSettings({ goalTargetCents: Math.round(parsed * 100), month: data && data.enabled ? data.month : undefined }, "Meta del mes actualizada.");
    } finally {
      setSavingGoal(false);
    }
  }

  async function onNameSubmit(event: FormEvent) {
    event.preventDefault();
    setSavingName(true);
    try {
      const trimmed = nameInput.trim();
      await saveSettings({ catName: trimmed ? trimmed : null }, trimmed ? `Listo, ahora tu gato se llama ${trimmed}.` : "Volvió a llamarse Sales Cat.");
    } finally {
      setSavingName(false);
    }
  }

  const pct = data?.enabled && data.goalTargetCents ? Math.min(100, Math.round((data.monthTotalCents / data.goalTargetCents) * 100)) : 0;
  const rawPct = data?.enabled && data.goalTargetCents ? Math.round((data.monthTotalCents / data.goalTargetCents) * 100) : 0;
  const remaining = data?.enabled && data.goalTargetCents ? Math.max(0, data.goalTargetCents - data.monthTotalCents) : 0;
  const daysLeft = data?.enabled && data.currentDay !== null ? Math.max(1, data.daysInMonth - data.currentDay + 1) : (data?.enabled ? data.daysInMonth : 1);
  const dailyNeeded = remaining > 0 ? Math.ceil(remaining / daysLeft) : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        onBack={onBack}
        agent="sales"
        title={data?.enabled && data.catName ? `${data.catName} (Sales Cat)` : "Sales Cat"}
        subtitle={`Metas del mes y nombre propio para ${company.name}. También puedes cambiarlos por WhatsApp con /sales.`}
      />

      {!data && !failed && (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" />
      )}
      {failed && (
        <p className="rounded-2xl border border-line bg-white px-5 py-4 text-ink-muted">
          No pudimos cargar los datos de Sales Cat. Vuelve a intentarlo en unos minutos.
        </p>
      )}
      {data && !data.enabled && (
        <p className="rounded-2xl border border-line bg-white px-5 py-4 text-ink-muted">
          Sales Cat todavía no está activo para {company.name}.
        </p>
      )}

      {data?.enabled && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-line bg-white p-6 space-y-4">
            <h2 className="text-lg font-bold text-ink">Meta de {monthLabel(data.month)}</h2>
            {data.goalTargetCents ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-bold text-ink">{soles(data.monthTotalCents)}</span>
                  <span className="text-sm text-ink-muted">de {soles(data.goalTargetCents)} ({rawPct} %)</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-subtle">
                  <div className="h-full rounded-full bg-forest transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm text-ink-muted">
                  {remaining > 0
                    ? `Te faltan ${soles(remaining)} (${soles(dailyNeeded)} al día en ${daysLeft} ${daysLeft === 1 ? "día" : "días"}).`
                    : "¡Meta cumplida este mes!"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Llevas {soles(data.monthTotalCents)} en {data.monthCount} {data.monthCount === 1 ? "venta confirmada" : "ventas confirmadas"}. Aún no fijaste meta para este mes.
              </p>
            )}

            <form onSubmit={onGoalSubmit} className="space-y-3 pt-2">
              <label className="block text-sm font-medium text-ink" htmlFor="sales-goal-input">
                Meta mensual (S/)
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="sales-goal-input"
                  type="number"
                  min="1"
                  step="0.01"
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  placeholder="20000"
                  className="input flex-1"
                />
                <button type="submit" disabled={savingGoal} className="btn-primary min-h-11">
                  {savingGoal ? "Guardando…" : "Guardar meta"}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-line bg-white p-6 space-y-4">
            <h2 className="text-lg font-bold text-ink">Nombre de tu gato</h2>
            <p className="text-sm text-ink-muted">
              Si le pones un nombre propio (por ejemplo, Michi), puedes escribirle «Michi, ¿cuánto vendimos hoy?» en el chat de WhatsApp igual que con /sales.
            </p>
            <form onSubmit={onNameSubmit} className="space-y-3">
              <label className="block text-sm font-medium text-ink" htmlFor="sales-cat-name-input">
                Nombre propio (2 a 20 caracteres)
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="sales-cat-name-input"
                  type="text"
                  maxLength={20}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Michi"
                  className="input flex-1"
                />
                <button type="submit" disabled={savingName} className="btn-secondary min-h-11">
                  {savingName ? "Guardando…" : "Guardar nombre"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {message && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</p>}
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</p>}
    </div>
  );
}
