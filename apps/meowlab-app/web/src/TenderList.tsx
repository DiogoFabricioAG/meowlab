import { useState } from "react";
import type { Weekly } from "./agents";
import { formatDeadline, formatWeekRange } from "./tenderDates";
import { Icon } from "./icons";
import { PageHeader } from "./PageHeader";

type TenderHighlight = Weekly["tender"]["highlights"][number];
type TenderFilter = "all" | "saved";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tender Cat's weekly highlights list: «Destacadas de la semana» with «Todas / Guardadas»
 * filter buttons (aria-pressed), error banners, and empty/inactive states.
 */
export function TenderList({
  weekly,
  weeklyFailed = false,
  opportunitiesError = "",
  onReloadOpportunities,
  onBack,
  onSelect,
  hiddenError = "",
}: {
  weekly: Weekly | null;
  weeklyFailed?: boolean;
  opportunitiesError?: string;
  onReloadOpportunities?: () => void;
  onBack: () => void;
  onSelect: (item: TenderHighlight) => void;
  hiddenError?: string;
}) {
  const [filter, setFilter] = useState<TenderFilter>("all");

  const tender = weekly?.tender ?? null;
  const highlights = tender?.highlights ?? [];
  const showActivity = Boolean(
    tender && (tender.enabled || tender.found > 0 || highlights.length > 0),
  );
  const savedItems = highlights.filter((item) => item.interesting);
  const visible = filter === "saved" ? savedItems : highlights;
  const weekLabel = weekly ? formatWeekRange(weekly.week?.start, weekly.week?.end) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        onBack={onBack}
        agent="tender"
        title="Tender Cat"
        subtitle={
          weeklyFailed
            ? "No pudimos cargar el resumen semanal de esta semana."
            : !weekly
              ? "Revisando las licitaciones de esta semana…"
              : !showActivity
                ? "Tender Cat no está activo para esta empresa."
                : tender && tender.found === 0
                  ? "Esta semana no encontró licitaciones nuevas."
                  : `Esta semana encontró ${plural(tender?.found ?? 0, "licitación", "licitaciones")}${
                      (tender?.interesting ?? 0) > 0 ? ` · ${plural(tender!.interesting, "guardada", "guardadas")}` : ""
                    }.`
        }
        actions={weekLabel ? <p className="text-sm text-ink-muted">{weekLabel}</p> : undefined}
      />

      {weeklyFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-2"
        >
          <span>No pudimos cargar las destacadas de la semana.</span>
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
      )}
    </div>
  );
}
