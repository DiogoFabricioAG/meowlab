import { useState } from "react";
import { agentLogo, type Weekly } from "./agents";
import { formatDeadline, formatWeekRange } from "./tenderDates";
import type { TenderOpportunity } from "./tenderApi";
import { Icon } from "./icons";

type TenderHighlight = Weekly["tender"]["highlights"][number];
type TenderFilter = "all" | "saved";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tender Cat's weekly highlights list: command-centre KPIs, real weekly highlights with
 * «Todas / Guardadas» toggle buttons (aria-pressed), plus historical saved cases when passed.
 */
export function TenderList({
  weekly,
  weeklyFailed = false,
  savedOpportunities = [],
  opportunitiesError = "",
  onReloadOpportunities,
  onBack,
  onSelect,
  onSelectOpportunity,
  onToggleHidden,
  hiddenBusyId = null,
  hiddenError = "",
}: {
  weekly: Weekly | null;
  weeklyFailed?: boolean;
  savedOpportunities?: TenderOpportunity[];
  opportunitiesError?: string;
  onReloadOpportunities?: () => void;
  onBack: () => void;
  onSelect: (item: TenderHighlight) => void;
  onSelectOpportunity?: (op: TenderOpportunity) => void;
  onToggleHidden?: (op: TenderOpportunity) => Promise<void>;
  hiddenBusyId?: string | null;
  hiddenError?: string;
}) {
  const [filter, setFilter] = useState<TenderFilter>("all");

  const tender = weekly?.tender ?? null;
  const highlights = tender?.highlights ?? [];
  const highlightOcids = new Set(highlights.map((h) => h.ocid).filter(Boolean));
  const historicalSaved = savedOpportunities.filter(
    (op) => op.selection === "interesting" && !op.hidden && (!op.alert.ocid || !highlightOcids.has(op.alert.ocid)),
  );
  const historicalHidden = savedOpportunities.filter((op) => op.hidden);
  const showActivity = Boolean(
    tender && (tender.enabled || tender.found > 0 || highlights.length > 0 || historicalSaved.length > 0),
  );
  const savedItems = highlights.filter((item) => item.interesting);
  const visible = filter === "saved" ? savedItems : highlights;
  const weekLabel = weekly ? formatWeekRange(weekly.week?.start, weekly.week?.end) : null;

  function renderHistoricalList(
    title: string,
    headingId: string,
    rows: TenderOpportunity[],
    isHiddenList: boolean,
  ) {
    if (rows.length === 0 || !onSelectOpportunity) return null;
    return (
      <section
        className="overflow-hidden rounded-2xl border border-line bg-white"
        aria-labelledby={headingId}
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id={headingId} className="text-xl text-ink">
            {title} ({rows.length})
          </h2>
        </header>
        <ul className="divide-y divide-line">
          {rows.map((op) => {
            const rowTitle = op.alert.displayTitle || op.alert.description?.trim() || op.alert.code;
            const deadline = formatDeadline(op.alert.deadline);
            const meta = [op.alert.buyer, deadline ? `Cierra ${deadline}` : "", op.alert.amount]
              .filter(Boolean);
            const busy = hiddenBusyId === op.id;
            return (
              <li key={op.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => onSelectOpportunity(op)}
                  className="flex min-h-11 min-w-0 flex-1 items-start justify-between gap-3 text-left transition-colors hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                        isHiddenList ? "bg-surface-subtle text-ink-muted" : "bg-mint text-forest"
                      }`}
                    >
                      <Icon name={isHiddenList ? "radar" : "star"} className="h-4 w-4" />
                    </span>
                    <span className="block min-w-0 space-y-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="wrap-anywhere font-semibold text-ink">{rowTitle}</span>
                        <span
                          className={`chip border ${
                            isHiddenList
                              ? "border-line bg-surface-subtle text-ink-muted"
                              : "border-line-mint bg-mint-light text-forest"
                          }`}
                        >
                          {op.basesUploaded ? "Con bases" : "Falta bases"}
                        </span>
                      </span>
                      {meta.length > 0 && (
                        <span className="block wrap-anywhere text-sm text-ink-muted">
                          {meta.join(" · ")}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="mt-1 shrink-0 text-sm font-semibold text-forest">
                    Abrir <span aria-hidden="true">→</span>
                  </span>
                </button>
                {onToggleHidden && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onToggleHidden(op)}
                    className="btn-secondary min-h-10 shrink-0 px-3.5 py-2 text-xs"
                  >
                    {busy ? "Actualizando…" : isHiddenList ? "Restaurar" : "Quitar"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <span aria-hidden="true">←</span> Tus agentes
      </button>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-3 text-3xl tracking-tight text-ink sm:text-4xl">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mint">
              <img
                src={agentLogo("tender")}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 mix-blend-multiply"
                decoding="async"
              />
            </span>
            Tender Cat
          </h1>
          <p className="text-ink-muted">
            {weeklyFailed
              ? "No pudimos cargar el resumen semanal de esta semana."
              : !weekly
                ? "Revisando las licitaciones de esta semana…"
                : !showActivity
                  ? "Tender Cat no está activo para esta empresa."
                  : tender && tender.found === 0 && historicalSaved.length === 0
                    ? "Esta semana no encontró licitaciones nuevas."
                    : `Esta semana encontró ${plural(tender?.found ?? 0, "licitación", "licitaciones")}${
                        (tender?.interesting ?? 0) > 0 ? ` · ${plural(tender!.interesting, "guardada", "guardadas")}` : ""
                      }.`}
          </p>
        </div>
        {weekLabel && <p className="text-sm text-ink-muted">{weekLabel}</p>}
      </header>

      {weeklyFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-2"
        >
          <span>No pudimos cargar las destacadas de la semana. Puedes abrir tus expedientes guardados abajo.</span>
          <button type="button" onClick={() => window.location.reload()} className="btn-secondary min-h-10 px-4 py-2 text-sm">
            Reintentar
          </button>
        </div>
      )}

      {opportunitiesError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900"
        >
          <span>{opportunitiesError}</span>
          {onReloadOpportunities && (
            <button type="button" onClick={onReloadOpportunities} className="btn-secondary min-h-10 px-4 py-2 text-sm">
              Reintentar
            </button>
          )}
        </div>
      )}

      {hiddenError && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-900">
          {hiddenError}
        </div>
      )}

      {!weekly && !weeklyFailed && (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando">
          <div className="h-24 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
          <div className="h-48 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
        </div>
      )}

      {weekly && !showActivity && !weeklyFailed && (
        <section className="rounded-2xl border border-dashed border-line-mint bg-white px-5 py-6">
          <p className="text-ink-2">
            Cuando Tender Cat esté activo para esta empresa, verás aquí las licitaciones encontradas.
          </p>
        </section>
      )}

      {weekly && showActivity && (
        <>
          <section aria-label="Resumen semanal">
            <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-white sm:grid-cols-3">
              <div className="min-w-0 px-5 py-4">
                <dt className="text-sm text-ink-muted">Encontradas</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums sm:text-[28px]">
                  {tender?.found ?? 0}
                </dd>
              </div>
              <div className="min-w-0 border-l border-line px-5 py-4">
                <dt className="text-sm text-ink-muted">Hoy</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums sm:text-[28px]">
                  {tender?.foundToday ?? 0}
                </dd>
              </div>
              <div className="col-span-2 min-w-0 border-t border-line px-5 py-4 sm:col-span-1 sm:border-t-0 sm:border-l">
                <dt className="text-sm text-ink-muted">Guardadas</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-forest tabular-nums sm:text-[28px]">
                  {tender?.interesting ?? 0}
                </dd>
              </div>
            </dl>
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby="tender-list-title">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 id="tender-list-title" className="text-xl text-ink">
                Destacadas de la semana
              </h2>
              <div
                className="inline-flex rounded-[10px] bg-surface-subtle p-1"
                role="group"
                aria-label="Filtrar licitaciones"
              >
                <button
                  type="button"
                  aria-pressed={filter === "all"}
                  onClick={() => setFilter("all")}
                  className={`min-h-10 rounded-[8px] px-3.5 text-sm font-semibold transition-colors ${
                    filter === "all" ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  Todas ({highlights.length})
                </button>
                <button
                  type="button"
                  aria-pressed={filter === "saved"}
                  onClick={() => setFilter("saved")}
                  className={`min-h-10 rounded-[8px] px-3.5 text-sm font-semibold transition-colors ${
                    filter === "saved" ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  Guardadas ({savedItems.length})
                </button>
              </div>
            </header>

            {visible.length === 0 ? (
              <div className="px-5 py-6 text-ink-muted">
                {filter === "saved" && highlights.length > 0 ? (
                  <>
                    <p>No hay licitaciones guardadas entre las destacadas de esta semana.</p>
                    <button
                      type="button"
                      onClick={() => setFilter("all")}
                      className="btn-secondary mt-3 min-h-11"
                    >
                      Ver todas ({highlights.length})
                    </button>
                  </>
                ) : (
                  <p>No hay licitaciones destacadas para mostrar en esta semana.</p>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {visible.map((item, index) => {
                  const title = item.displayTitle || item.description?.trim() || "Licitación sin título";
                  const buyer = item.buyer?.trim() || "";
                  const deadline = formatDeadline(item.deadline);
                  const amount = item.amount?.trim() || "";
                  const meta = [buyer, deadline ? `Cierra ${deadline}` : "", amount].filter(Boolean);

                  return (
                    <li key={item.ocid || `${index}-${item.description}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        className="flex min-h-11 w-full items-start justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-forest"
                      >
                        <span className="flex min-w-0 items-start gap-3">
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                              item.interesting ? "bg-mint text-forest" : "bg-surface-subtle text-ink-muted"
                            }`}
                          >
                            <Icon name={item.interesting ? "star" : "radar"} className="h-4 w-4" />
                          </span>
                          <span className="block min-w-0 space-y-1.5">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="wrap-anywhere font-semibold text-ink">{title}</span>
                              {item.interesting && (
                                <span className="chip border border-line-mint bg-mint-light text-forest">
                                  Guardada
                                </span>
                              )}
                            </span>
                            {meta.length > 0 && (
                              <span className="block wrap-anywhere text-sm text-ink-muted">
                                {meta.join(" · ")}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="mt-1 shrink-0 text-sm font-semibold text-forest">
                          Ver <span aria-hidden="true">→</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="border-t border-line bg-surface-subtle px-5 py-2.5 text-xs text-ink-muted">
              Las marcas «Me interesa» se eligen desde el aviso en WhatsApp.
            </p>
          </section>
        </>
      )}

      {renderHistoricalList("Guardadas anteriores", "tender-historical-title", historicalSaved, false)}
      {renderHistoricalList("Quitadas", "tender-hidden-title", historicalHidden, true)}
    </div>
  );
}
