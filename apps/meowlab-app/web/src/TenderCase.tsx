import { useCallback, useEffect, useRef, useState } from "react";
import { agentLogo, type Weekly } from "./agents";
import { Icon } from "./icons";
import { TenderBases } from "./TenderBases";
import { TenderDocuments } from "./TenderDocuments";
import { TenderQuote } from "./TenderQuote";
import { portalTenderUrl, tenderApi, TenderApiError, type TenderOpportunity, type Work } from "./tenderApi";
import { formatDeadline } from "./tenderDates";

export type TenderHighlight = Weekly["tender"]["highlights"][number];
export type TenderWorkspaceStage = "bases" | "quote" | "documents";

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

const STAGES: Array<{ key: TenderWorkspaceStage; label: string }> = [
  { key: "bases", label: "Resumen y bases" },
  { key: "quote", label: "Cotización" },
  { key: "documents", label: "Expediente" },
];

/**
 * Native MeowLab Tender Cat case workspace: facts, uploaded bases,
 * quote preparation, editable dossier documents and persistent draft saving.
 */
export function TenderCase({
  companyId,
  item,
  opportunity,
  loadingOpportunity = false,
  opportunityError = "",
  stage = "bases",
  onStageChange,
  onBack,
  onOpportunityUpdated,
  onReloadOpportunity,
  onToggleHidden,
  hiddenBusy = false,
  hiddenError = "",
  onSync,
  syncing = false,
  syncError = "",
}: {
  companyId: string;
  item: TenderHighlight;
  opportunity: TenderOpportunity | null;
  loadingOpportunity?: boolean;
  opportunityError?: string;
  stage?: TenderWorkspaceStage;
  onStageChange?: (next: TenderWorkspaceStage) => void;
  onBack: () => void;
  onOpportunityUpdated: (updated: TenderOpportunity) => void;
  onReloadOpportunity: () => void;
  onToggleHidden?: (op: TenderOpportunity) => Promise<void>;
  hiddenBusy?: boolean;
  hiddenError?: string;
  onSync?: () => Promise<void>;
  syncing?: boolean;
  syncError?: string;
}) {
  const [localStage, setLocalStage] = useState<TenderWorkspaceStage>(stage);
  const activeStage = onStageChange ? stage : localStage;
  const setStage = onStageChange ?? setLocalStage;

  const [draft, setDraft] = useState<Work>(() => opportunity?.work ?? {});
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [saveError, setSaveError] = useState("");
  const [leaving, setLeaving] = useState(false);

  const opportunityRef = useRef(opportunity);
  const draftRef = useRef<Work>(draft);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const inFlightPromiseRef = useRef<Promise<boolean> | null>(null);
  const queuedSaveRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    opportunityRef.current = opportunity;
    if (!dirtyRef.current) {
      const nextWork = opportunity?.work ?? {};
      setDraft(nextWork);
      draftRef.current = nextWork;
      setSaveStatus("saved");
      setSaveError("");
    }
  }, [opportunity]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const triggerSave = useCallback(async (): Promise<boolean> => {
    const currentOpp = opportunityRef.current;
    if (!currentOpp) return true;
    if (inFlightRef.current && inFlightPromiseRef.current) {
      queuedSaveRef.current = true;
      await inFlightPromiseRef.current;
      if (!dirtyRef.current && !inFlightRef.current) return true;
      if (inFlightRef.current && inFlightPromiseRef.current) {
        return inFlightPromiseRef.current;
      }
    }

    const runSave = async (): Promise<boolean> => {
      const targetOpp = opportunityRef.current;
      if (!targetOpp) return true;
      inFlightRef.current = true;
      setSaveStatus("saving");
      setSaveError("");

      const payloadWork = draftRef.current;
      try {
        const updated = await tenderApi<TenderOpportunity>(
          companyId,
          `/opportunities/${encodeURIComponent(targetOpp.id)}`,
          {
            method: "PUT",
            body: {
              notes: payloadWork.notes ?? "",
              document: payloadWork.document ?? "",
              quotes: payloadWork.quotes ?? [],
              documentEdits: payloadWork.documentEdits ?? {},
              checklist: payloadWork.checklist ?? [],
              version: targetOpp.version,
              hidden: targetOpp.hidden ?? false,
            },
          },
        );
        if (opportunityRef.current?.id !== targetOpp.id) return false;
        opportunityRef.current = updated;
        onOpportunityUpdated(updated);

        if (JSON.stringify(draftRef.current) === JSON.stringify(payloadWork)) {
          setDirty(false);
          dirtyRef.current = false;
          setSaveStatus("saved");
          return true;
        }
        queuedSaveRef.current = true;
        return false;
      } catch (e) {
        const isConflict = e instanceof TenderApiError && e.status === 409;
        setSaveStatus(isConflict ? "conflict" : "error");
        setSaveError(
          isConflict
            ? "Este expediente se actualizó en otro lugar. Recarga para ver la última versión antes de seguir editando."
            : e instanceof Error
              ? e.message
              : "No se pudieron guardar los cambios.",
        );
        return false;
      } finally {
        inFlightRef.current = false;
      }
    };

    const promise = runSave();
    inFlightPromiseRef.current = promise;
    let ok = await promise;
    while (queuedSaveRef.current && opportunityRef.current) {
      queuedSaveRef.current = false;
      const nextPromise = runSave();
      inFlightPromiseRef.current = nextPromise;
      ok = await nextPromise;
    }
    if (inFlightPromiseRef.current === promise) {
      inFlightPromiseRef.current = null;
    }
    return ok;
  }, [companyId, onOpportunityUpdated]);

  function scheduleAutoSave(delay = 800) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void triggerSave();
    }, delay);
  }

  function handleEdit(value: Partial<Work>) {
    setDraft((prev) => {
      const next = { ...prev, ...value };
      draftRef.current = next;
      return next;
    });
    setDirty(true);
    dirtyRef.current = true;
    setSaveStatus("saving");
    setSaveError("");
    scheduleAutoSave();
  }

  async function handleBack() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (dirtyRef.current || inFlightRef.current) {
      if (saveStatus === "conflict") return;
      setLeaving(true);
      const saved = await triggerSave();
      setLeaving(false);
      if (!saved) return;
    }
    onBack();
  }

  function handleDiscardAndBack() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    dirtyRef.current = false;
    setDirty(false);
    onBack();
  }

  function handleStageSwitch(nextStage: TenderWorkspaceStage) {
    if (dirtyRef.current && saveStatus !== "conflict") {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void triggerSave();
    }
    setStage(nextStage);
  }

  const seaceUrl = safeHttpsUrl(opportunity?.alert.sourceUrl ?? item.sourceUrl);
  const title = item.displayTitle || opportunity?.alert.displayTitle || item.description?.trim() || "Licitación sin título";
  const officialDescription = item.description || opportunity?.alert.description || "";
  const buyer = item.buyer || opportunity?.alert.buyer || "No especificado";
  const deadline = formatDeadline(item.deadline || opportunity?.alert.deadline) || "No especificado";
  const amount = item.amount || opportunity?.alert.amount || "No especificado";
  const isSaved = Boolean(item.interesting || opportunity?.selection === "interesting");

  const factsNote = !isSaved
    ? "Para guardarla, pulsa «Me interesa» en el aviso del WhatsApp de tu empresa."
    : opportunity
      ? "Guardada por tu equipo desde WhatsApp."
      : "Esta convocatoria aún no figura sincronizada para edición en tu cuenta.";

  return (
    <article className="space-y-6 wrap-anywhere" aria-labelledby="tender-case-title">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={() => void handleBack()}
          disabled={leaving}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest underline-offset-4 hover:underline disabled:opacity-60"
        >
          <span aria-hidden="true">←</span> {leaving ? "Guardando antes de salir…" : "Volver a licitaciones"}
        </button>

        {opportunity && (
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            {saveStatus === "saving" && (
              <span role="status" className="chip border border-line bg-surface-subtle text-ink-muted">
                Guardando…
              </span>
            )}
            {saveStatus === "saved" && !dirty && (
              <span className="chip border border-line-mint bg-mint-light text-forest">
                Guardado · v{opportunity.version}
              </span>
            )}
            {(saveStatus === "error" || saveStatus === "conflict") && (
              <span role="alert" className="chip border border-red-200 bg-red-50 text-red-800">
                {saveStatus === "conflict" ? "Conflicto de versión" : "Error al guardar"}
              </span>
            )}
            {onToggleHidden && (
              <button
                type="button"
                disabled={hiddenBusy}
                onClick={() => void onToggleHidden(opportunity)}
                className="inline-flex min-h-9 items-center rounded-[10px] border border-line bg-white px-3 text-xs font-semibold text-ink-2 transition-colors hover:border-forest hover:text-forest disabled:opacity-60"
              >
                {hiddenBusy ? "Actualizando…" : opportunity.hidden ? "Restaurar" : "Quitar"}
              </button>
            )}
          </div>
        )}
      </div>

      <header className="space-y-3 rounded-2xl border border-line bg-white px-5 py-5 sm:px-6 print:hidden">
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
          {isSaved ? (
            <span className="chip border border-line-mint bg-mint-light text-forest">
              Guardada
            </span>
          ) : (
            <span className="chip border border-line bg-surface-subtle text-ink-muted">
              No guardada
            </span>
          )}
          {opportunity?.hidden && (
            <span className="chip border border-line bg-surface-subtle text-ink-muted">
              Quitada
            </span>
          )}
          {opportunity?.alert.code && (
            <span className="chip border border-line bg-surface-subtle text-ink-2">
              {opportunity.alert.code}
            </span>
          )}
        </div>

        <h1 id="tender-case-title" className="text-2xl tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        {officialDescription && officialDescription !== title && (
          <details className="text-sm text-ink-muted">
            <summary className="w-fit cursor-pointer font-medium text-forest">Ver descripción oficial</summary>
            <p className="mt-2 leading-relaxed">{officialDescription}</p>
          </details>
        )}
      </header>

      {hiddenError && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-900 print:hidden">
          {hiddenError}
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900 print:hidden"
        >
          <span>{saveError}</span>
          <div className="flex flex-wrap items-center gap-2">
            {saveStatus === "conflict" ? (
              <button
                type="button"
                onClick={() => {
                  setDirty(false);
                  dirtyRef.current = false;
                  onReloadOpportunity();
                }}
                className="btn-secondary min-h-10 px-4 py-2 text-sm"
              >
                Recargar expediente
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void triggerSave()}
                className="btn-secondary min-h-10 px-4 py-2 text-sm"
              >
                Reintentar guardado
              </button>
            )}
            <button
              type="button"
              onClick={handleDiscardAndBack}
              className="inline-flex min-h-10 items-center rounded-[10px] border border-red-300 bg-white px-3.5 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
            >
              Descartar cambios y volver
            </button>
          </div>
        </div>
      )}

      <section
        aria-labelledby="tender-facts-heading"
        className="overflow-hidden rounded-2xl border border-line bg-white print:hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id="tender-facts-heading" className="text-xl text-ink">
            Datos de la convocatoria
          </h2>
          {seaceUrl && (
            <a
              href={seaceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line px-3.5 text-sm font-semibold text-forest transition-colors hover:border-forest"
            >
              Ver en SEACE
              <Icon name="external" className="h-4 w-4" />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-3">
          <div className="min-w-0 px-5 py-4">
            <dt className="text-sm text-ink-muted">Comprador</dt>
            <dd className="mt-1 text-base font-semibold text-ink">{buyer}</dd>
          </div>

          <div className="min-w-0 border-t border-line px-5 py-4 sm:border-l sm:border-t-0">
            <dt className="text-sm text-ink-muted">Plazo / Cierre</dt>
            <dd className="mt-1 text-base font-semibold text-ink tabular-nums">{deadline}</dd>
          </div>

          <div className="min-w-0 border-t border-line px-5 py-4 sm:border-l sm:border-t-0">
            <dt className="text-sm text-ink-muted">Monto referencial</dt>
            <dd className="mt-1 text-base font-semibold text-ink tabular-nums">{amount}</dd>
          </div>
        </dl>

        <div className="space-y-2 border-t border-line bg-surface-subtle px-5 py-2.5 text-xs text-ink-muted">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{factsNote}</span>
            {isSaved && !opportunity && !loadingOpportunity && !opportunityError && onSync && (
              <button
                type="button"
                disabled={syncing}
                onClick={() => void onSync()}
                className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              >
                {syncing ? "Sincronizando…" : "Sincronizar ahora"}
              </button>
            )}
          </div>
          {syncError && (
            <p role="alert" className="text-red-700">
              {syncError}
            </p>
          )}
          {opportunity?.documents && opportunity.documents.length > 0 && (
            <ul className="flex flex-wrap gap-3 pt-1">
              {opportunity.documents.map((doc, idx) => {
                const href = portalTenderUrl(companyId, doc.url);
                if (!href) return null;
                return (
                  <li key={`${doc.title}-${idx}`}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-forest underline underline-offset-2"
                    >
                      {doc.title || "Documento oficial"}
                      <span className="sr-only"> (se abre en otra pestaña)</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {loadingOpportunity && !opportunity && (
        <div className="h-48 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando expediente" />
      )}

      {opportunityError && !opportunity && !loadingOpportunity && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-2">
          <span>{opportunityError}</span>
          <button type="button" onClick={onReloadOpportunity} className="btn-secondary min-h-10 px-4 py-2 text-sm">
            Reintentar
          </button>
        </div>
      )}

      {opportunity && !opportunity.basesUploaded && (
        <TenderBases
          companyId={companyId}
          opportunity={opportunity}
          onOpportunityUpdated={onOpportunityUpdated}
        />
      )}

      {opportunity && opportunity.basesUploaded && (
        <div className="space-y-5">
          <div
            className="grid w-full grid-cols-3 gap-1 rounded-[12px] bg-surface-subtle p-1 sm:w-fit print:hidden"
            role="group"
            aria-label="Etapas del expediente"
          >
            {STAGES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                aria-pressed={activeStage === entry.key}
                onClick={() => handleStageSwitch(entry.key)}
                className={`min-h-10 rounded-[10px] px-3 py-2 text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${
                  activeStage === entry.key
                    ? "bg-white text-forest shadow-soft"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {activeStage === "bases" && (
            <div className="space-y-5">
              <TenderBases
                companyId={companyId}
                opportunity={opportunity}
                onOpportunityUpdated={onOpportunityUpdated}
              />

              <section className="space-y-3 rounded-2xl border border-line bg-white p-5">
                <label className="block space-y-1.5">
                  <span className="text-base font-semibold text-ink">Notas del expediente</span>
                  <span className="block text-xs text-ink-muted">
                    Apuntes internos de tu equipo sobre esta licitación (se guardan automáticamente).
                  </span>
                  <textarea
                    rows={4}
                    value={draft.notes ?? ""}
                    onChange={(e) => handleEdit({ notes: e.target.value })}
                    placeholder="Anota plazos clave, condiciones de entrega o acuerdos internos…"
                    className="field mt-2 text-sm"
                  />
                </label>
              </section>
            </div>
          )}

          {activeStage === "quote" && (
            <TenderQuote
              companyId={companyId}
              opportunity={opportunity}
              work={draft}
              onEdit={handleEdit}
            />
          )}

          {activeStage === "documents" && (
            <TenderDocuments
              companyId={companyId}
              opportunity={opportunity}
              work={draft}
              dirty={dirty}
              onEdit={handleEdit}
            />
          )}
        </div>
      )}
    </article>
  );
}
