import { useState } from "react";
import { agentLogo, type Weekly } from "./agents";
import { Icon } from "./icons";

type TenderHighlight = Weekly["tender"]["highlights"][number];
type TenderFilter = "all" | "saved";

const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatWeekRange(start?: string | null, end?: string | null): string | null {
  const s = typeof start === "string" ? ISO_DAY_RE.exec(start.trim()) : null;
  const e = typeof end === "string" ? ISO_DAY_RE.exec(end.trim()) : null;
  if (!s || !e) return null;
  return `Semana del ${s[3]}/${s[2]} al ${e[3]}/${e[2]}`;
}

function formatDeadline(raw?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (ISO_DAY_RE.test(value)) {
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("es-PE", { day: "numeric", month: "short", timeZone: "UTC" });
    }
  }
  return value;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tender Cat's weekly highlights list: command-centre KPIs, real weekly highlights with
 * «Todas / Guardadas» toggle buttons (aria-pressed), and row selection via onSelect.
 */
export function TenderList({
  weekly,
  onBack,
  onSelect,
}: {
  weekly: Weekly | null;
  onBack: () => void;
  onSelect: (item: TenderHighlight) => void;
}) {
  const [filter, setFilter] = useState<TenderFilter>("all");

  const tender = weekly?.tender ?? null;
  const highlights = tender?.highlights ?? [];
  const savedItems = highlights.filter((item) => item.interesting);
  const visible = filter === "saved" ? savedItems : highlights;
  const weekLabel = weekly ? formatWeekRange(weekly.week?.start, weekly.week?.end) : null;

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
            {!weekly
              ? "Revisando las licitaciones de esta semana…"
              : !tender?.enabled
                ? "Tender Cat no está activo para esta empresa."
                : tender.found === 0
                  ? "Esta semana no encontró licitaciones nuevas."
                  : `Esta semana encontró ${plural(tender.found, "licitación", "licitaciones")}${
                      tender.interesting > 0 ? ` · ${plural(tender.interesting, "guardada", "guardadas")}` : ""
                    }.`}
          </p>
        </div>
        {weekLabel && <p className="text-sm text-ink-muted">{weekLabel}</p>}
      </header>

      {!weekly && (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando">
          <div className="h-24 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
          <div className="h-48 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" />
        </div>
      )}

      {weekly && !tender?.enabled && (
        <section className="rounded-2xl border border-dashed border-line-mint bg-white px-5 py-6">
          <p className="text-ink-2">
            Activa Tender Cat en tu chat con Manolo para recibir avisos semanales de licitaciones.
          </p>
        </section>
      )}

      {weekly && tender?.enabled && (
        <>
          <section aria-label="Resumen semanal">
            <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-white sm:grid-cols-3">
              <div className="min-w-0 px-5 py-4">
                <dt className="text-sm text-ink-muted">Encontradas</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums sm:text-[28px]">
                  {tender.found}
                </dd>
              </div>
              <div className="min-w-0 border-l border-line px-5 py-4">
                <dt className="text-sm text-ink-muted">Hoy</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums sm:text-[28px]">
                  {tender.foundToday}
                </dd>
              </div>
              <div className="col-span-2 min-w-0 border-t border-line px-5 py-4 sm:col-span-1 sm:border-t-0 sm:border-l">
                <dt className="text-sm text-ink-muted">Guardadas</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-forest tabular-nums sm:text-[28px]">
                  {tender.interesting}
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
                  const title = item.description?.trim() || "Licitación sin título";
                  const buyer = item.buyer?.trim() || "";
                  const deadline = formatDeadline(item.deadline);
                  const amount = item.amount?.trim() || "";
                  const meta = [buyer, deadline ? `Cierra ${deadline}` : "", amount].filter(Boolean);

                  return (
                    <li key={`${index}-${title}-${item.deadline ?? ""}`}>
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
                          <span className="min-w-0 space-y-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-ink">{title}</span>
                              {item.interesting && (
                                <span className="chip border border-line-mint bg-mint-light text-forest">
                                  Guardada
                                </span>
                              )}
                            </span>
                            {meta.length > 0 && (
                              <span className="block text-sm text-ink-muted">
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
    </div>
  );
}
