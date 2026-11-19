import { agentLogo, type Weekly } from "./agents";
import { Icon } from "./icons";

export type TenderHighlight = Weekly["tender"]["highlights"][number];
export type TenderWorkspaceStage = "quote" | "documents";

function safeHttpsUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeWorkspaceHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return safeHttpsUrl(value);
}

/** Detail view for a single Tender Cat highlight harmonized with WeeklyHome. */
export function TenderCase({
  item,
  onBack,
  workspaceUrl,
}: {
  item: TenderHighlight;
  onBack: () => void;
  workspaceUrl: (stage: TenderWorkspaceStage) => string;
}) {
  const seaceUrl = safeHttpsUrl(item.sourceUrl);
  const quoteHref = safeWorkspaceHref(workspaceUrl("quote"));
  const documentsHref = safeWorkspaceHref(workspaceUrl("documents"));

  return (
    <article className="space-y-6" aria-labelledby="tender-case-title">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <span aria-hidden="true">←</span> Volver a licitaciones
      </button>

      <header className="space-y-3 rounded-2xl border border-line bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mint">
            <img
              src={agentLogo("tender")}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 mix-blend-multiply"
              decoding="async"
            />
          </span>
          <span className="text-sm font-semibold text-ink-muted">
            Ficha de licitación · Tender Cat
          </span>
          {item.interesting ? (
            <span className="chip border border-line-mint bg-mint-light text-forest">
              Guardada
            </span>
          ) : (
            <span className="chip border border-line bg-surface-subtle text-ink-muted">
              No guardada
            </span>
          )}
        </div>

        <h1
          id="tender-case-title"
          className="text-2xl tracking-tight text-ink sm:text-3xl"
        >
          {item.description}
        </h1>
      </header>

      <section
        aria-labelledby="tender-facts-heading"
        className="overflow-hidden rounded-2xl border border-line bg-white"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id="tender-facts-heading" className="text-xl text-ink">
            Datos de la convocatoria
          </h2>
          {seaceUrl ? (
            <a
              href={seaceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line px-3.5 text-sm font-semibold text-forest transition-colors hover:border-forest"
            >
              Ver en OECE
              <Icon name="external" className="h-4 w-4" />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          ) : (
            <span className="text-sm text-ink-muted">Sin enlace OECE</span>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-3">
          <div className="min-w-0 px-5 py-4">
            <dt className="text-sm text-ink-muted">Comprador</dt>
            <dd className="mt-1 text-base font-semibold text-ink">
              {item.buyer || "No especificado"}
            </dd>
          </div>

          <div className="min-w-0 border-t border-line px-5 py-4 sm:border-l sm:border-t-0">
            <dt className="text-sm text-ink-muted">Plazo / Cierre</dt>
            <dd className="mt-1 text-base font-semibold text-ink tabular-nums">
              {item.deadline || "No especificado"}
            </dd>
          </div>

          <div className="min-w-0 border-t border-line px-5 py-4 sm:border-l sm:border-t-0">
            <dt className="text-sm text-ink-muted">Monto referencial</dt>
            <dd className="mt-1 text-base font-semibold text-ink tabular-nums">
              {item.amount || "No especificado"}
            </dd>
          </div>
        </dl>

        <p className="border-t border-line bg-surface-subtle px-5 py-2.5 text-xs text-ink-muted">
          {seaceUrl
            ? item.interesting
              ? "Guardada por tu equipo desde la alerta de Tender Cat."
              : "Para guardarla, respóndele «Me interesa» a Tender Cat en el chat de WhatsApp."
            : "Esta ficha no incluye un enlace HTTPS directo a OECE; sigue desde Cotización o Expediente abajo, o revisa la alerta original en WhatsApp."}
        </p>
      </section>

      <section
        aria-labelledby="tender-workspace-heading"
        className="overflow-hidden rounded-2xl border border-line bg-white"
      >
        <div className="border-b border-line px-5 py-3.5">
          <h2 id="tender-workspace-heading" className="text-xl text-ink">
            Acciones OECE
          </h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-ink-muted">
            Acceso web vigente para trabajar la licitación en tu espacio autenticado:
          </p>

          {(quoteHref || documentsHref) ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {quoteHref && (
                <a
                  href={quoteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary min-h-11 w-full sm:w-auto"
                >
                  <Icon name="invoice" className="h-4 w-4" />
                  Cotización
                  <Icon name="external" className="h-4 w-4" />
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              )}

              {documentsHref && (
                <a
                  href={documentsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary min-h-11 w-full border border-line bg-white hover:bg-surface-subtle sm:w-auto"
                >
                  <Icon name="radar" className="h-4 w-4" />
                  Expediente
                  <Icon name="external" className="h-4 w-4" />
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Los enlaces de Cotización y Expediente no están disponibles para esta ficha en este momento.
            </p>
          )}
        </div>

        <div className="border-t border-line bg-surface-subtle px-5 py-3 text-xs leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink">
            Bases en PDF por WhatsApp (en desarrollo, aún no operativo):
          </strong>{" "}
          el flujo previsto será responder «Me interesa» → el gato confirma y comparte un enlace para el PDF → adjuntas el documento por el WhatsApp dedicado. Mientras tanto, usa el acceso web vigente en Cotización y Expediente.
        </div>
      </section>
    </article>
  );
}
