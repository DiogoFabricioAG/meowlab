import { useState } from "react";
import {
  portalTenderUrl,
  tenderApi,
  tenderBase,
  useTenderWork,
  type TenderData,
  type TenderDocument,
  type TenderOpportunity,
  type Work,
} from "./tenderApi";

const LATER_STAGE_RE = /\b(entrega|pago|perfeccionamiento|contrato|ejecuci[oó]n|conformidad|buena pro|facultativ[oa])\b/i;

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isLaterStage(stage?: string | null): boolean {
  const value = (stage || "").trim();
  return Boolean(value && LATER_STAGE_RE.test(value));
}

export type TenderCheckItem = TenderData["checks"][number];

/**
 * Partition participation documents into:
 * - platformDrafts: editable drafts extracted from the bases (plus index/legacy)
 * - userDocuments: documents mentioned in the bases without an extracted draft (aportas tú)
 * Excludes later-stage items and deduplicates linked/overlapping entries.
 */
export function partitionParticipationItems(data: TenderData | null): {
  platformDrafts: TenderDocument[];
  savedDrafts: TenderDocument[];
  userDocuments: TenderCheckItem[];
} {
  if (!data) return { platformDrafts: [], savedDrafts: [], userDocuments: [] };

  const savedDrafts = data.documents.filter((doc) => doc.stage === "Trabajo guardado");
  const platformDrafts = data.documents.filter(
    (doc) => doc.stage !== "Trabajo guardado" && !isLaterStage(doc.stage),
  );
  const draftIds = new Set(platformDrafts.map((doc) => doc.id));
  const draftTitles = new Set(platformDrafts.map((doc) => normalizeLabel(doc.title)));
  const seenChecks = new Set<string>();
  const userDocuments: TenderCheckItem[] = [];

  for (const check of data.checks) {
    if (isLaterStage(check.stage)) continue;
    if (check.documentId && draftIds.has(check.documentId)) continue;
    const label = (check.title || check.text || "").trim();
    const norm = normalizeLabel(label);
    if (!norm || draftTitles.has(norm) || seenChecks.has(norm)) continue;
    seenChecks.add(norm);
    userDocuments.push(check);
  }

  return { platformDrafts, savedDrafts, userDocuments };
}

const AI_CHIPS = [
  {
    label: "Completar datos de mi empresa",
    instruction: "Rellenar los datos faltantes con la información oficial de mi empresa",
  },
  {
    label: "Formato de tabla formal",
    instruction: "Asegurar formato de tabla formal con columnas alineadas y totales",
  },
  {
    label: "Plazo 10 días / Garantía 12 meses",
    instruction: "Fijar plazo de entrega en 10 días calendario y garantía técnica de 12 meses",
  },
  {
    label: "Recalcular IGV y total en letras",
    instruction: "Recalcular subtotales, IGV (18%) y total expresado en números y letras",
  },
];

/**
 * Native MeowLab dossier workspace: participation document list (platform drafts vs.
 * user-supplied documents mentioned in the bases), draft editor, and .docx/.zip exports.
 */
export function TenderDocuments({
  companyId,
  opportunity,
  work,
  dirty,
  onEdit,
}: {
  companyId: string;
  opportunity: TenderOpportunity;
  work: Work;
  dirty: boolean;
  onEdit: (value: Partial<Work>) => void;
}) {
  const { data, error, refresh } = useTenderWork(companyId, opportunity.id);
  const [selected, setSelected] = useState("index");
  const [editor, setEditor] = useState(false);
  const [message, setMessage] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const { platformDrafts, savedDrafts, userDocuments } = partitionParticipationItems(data);
  const allDrafts = [...platformDrafts, ...savedDrafts];
  const current = allDrafts.find((d) => d.id === selected) ?? allDrafts[0];
  const text = current ? (work.documentEdits?.[current.id] ?? current.body) : "";
  const checks = work.checklist ?? [];
  const base = tenderBase(companyId);
  const oppEncoded = encodeURIComponent(opportunity.id);

  function toggleChecklist(id: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...checks, id]))
      : checks.filter((itemId) => itemId !== id);
    onEdit({ checklist: next });
  }

  function updateBody(value: string) {
    if (!current) return;
    onEdit({ documentEdits: { ...work.documentEdits, [current.id]: value } });
  }

  async function applyAiEdit(promptToUse?: string) {
    const instruction = (promptToUse ?? aiPrompt).trim();
    if (!instruction) {
      setAiError("Escribe una instrucción para editar el documento con IA.");
      return;
    }
    if (!current) return;
    setAiLoading(true);
    setAiError("");
    setMessage("");
    try {
      const resData = await tenderApi<{ content?: string }>(
        companyId,
        `/opportunities/${oppEncoded}/edit-document-ai`,
        {
          method: "POST",
          body: {
            documentId: current.id,
            documentTitle: current.title,
            currentContent: text,
            instruction,
          },
        },
      );
      if (typeof resData.content === "string") {
        updateBody(resData.content);
        setMessage("Documento actualizado con IA.");
        setAiPrompt("");
      }
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : "Error al procesar la edición.");
    } finally {
      setAiLoading(false);
    }
  }

  const prepRunning = Boolean(data && ["queued", "running"].includes(data.status));
  const prepFailed = data?.status === "failed";
  const hasAnyDownloadable = allDrafts.length > 0;
  const checkByDocId = new Map(
    (data?.checks ?? [])
      .filter((c) => Boolean(c.documentId))
      .map((c) => [c.documentId as string, c.id]),
  );

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-white px-5 py-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl text-ink">Documentos para participar</h2>
            <p className="text-sm text-ink-muted">
              Revisa qué entregar según las bases, edita los borradores de la plataforma y descárgalos en Word o ZIP.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {dirty || !hasAnyDownloadable ? (
              <span
                aria-disabled="true"
                className="btn-primary min-h-10 cursor-not-allowed px-4 py-2 text-sm opacity-60"
              >
                Descargar borradores (.ZIP)
              </span>
            ) : (
              <a
                href={`${base}/opportunities/${oppEncoded}/documents.zip`}
                className="btn-primary min-h-10 px-4 py-2 text-sm"
              >
                Descargar borradores (.ZIP)
              </a>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              className="btn-secondary min-h-10 px-4 py-2 text-sm"
            >
              Actualizar
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-3 rounded-xl border border-line-mint bg-mint-light px-4 py-3 text-sm text-forest">
            {message}
          </p>
        )}
        {dirty && (
          <p role="status" className="mt-3 rounded-xl border border-line bg-surface-subtle px-4 py-2.5 text-sm text-ink-2">
            Guardando cambios del expediente automáticamente…
          </p>
        )}
        {prepRunning && (
          <p role="status" className="mt-3 rounded-xl border border-line-mint bg-surface-subtle px-4 py-2.5 text-sm text-ink-2">
            Estamos leyendo las bases. Los documentos y borradores aparecerán aquí al terminar.
          </p>
        )}
        {prepFailed && (
          <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            No pudimos completar la lectura automática de las bases. Revisa el archivo subido o vuelve a intentarlo más tarde.
          </p>
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]">
        <section
          className="space-y-5 rounded-2xl border border-line bg-white p-5 print:hidden"
          aria-label="Lista de documentos para participar"
        >
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-ink">Borradores de la plataforma</h3>
              <span className="text-xs font-semibold text-ink-muted tabular-nums">
                {platformDrafts.length}
              </span>
            </div>

            {platformDrafts.length > 0 ? (
              <ul className="space-y-2" role="list">
                {platformDrafts.map((doc) => {
                  const isSelected = current?.id === doc.id;
                  const linkedCheckId = checkByDocId.get(doc.id);
                  const edited = Boolean(
                    work.documentEdits?.[doc.id] && work.documentEdits[doc.id] !== doc.body,
                  );
                  return (
                    <li
                      key={doc.id}
                      className={`rounded-xl border transition-colors ${
                        isSelected
                          ? "border-forest bg-mint-light/50"
                          : "border-line bg-surface-subtle/40 hover:border-line-mint"
                      }`}
                    >
                      <div className="flex items-start gap-2.5 p-3">
                        {linkedCheckId && (
                          <input
                            type="checkbox"
                            aria-label={`Marcar ${doc.title} como listo`}
                            checked={checks.includes(linkedCheckId)}
                            className="mt-1 h-4 w-4 shrink-0 accent-forest"
                            onChange={(e) => toggleChecklist(linkedCheckId, e.target.checked)}
                          />
                        )}
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelected(doc.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block text-sm font-semibold text-ink wrap-anywhere">
                            {doc.title}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                            <span className="chip border border-line-mint bg-white px-2 py-0.5 text-[11px] text-forest">
                              Borrador editable
                            </span>
                            {edited && (
                              <span className="chip border border-line bg-white px-2 py-0.5 text-[11px] text-ink-2">
                                Editado
                              </span>
                            )}
                            {doc.locator && <span>{doc.locator}</span>}
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">
                No hay formatos reproducibles extraídos de las bases todavía.
              </p>
            )}
          </div>

          <div className="space-y-2.5 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-ink">
                Mencionados en las bases (aportas tú)
              </h3>
              <span className="text-xs font-semibold text-ink-muted tabular-nums">
                {userDocuments.length}
              </span>
            </div>

            {userDocuments.length > 0 ? (
              <ul className="space-y-2" role="list">
                {userDocuments.map((docItem) => {
                  const checked = checks.includes(docItem.id);
                  return (
                    <li
                      key={docItem.id}
                      className="space-y-2 rounded-xl border border-line bg-white p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex cursor-pointer items-start gap-2.5 text-sm font-semibold text-ink">
                          <input
                            type="checkbox"
                            checked={checked}
                            className="mt-1 h-4 w-4 shrink-0 accent-forest"
                            onChange={(e) => toggleChecklist(docItem.id, e.target.checked)}
                          />
                          <span className="wrap-anywhere">{docItem.title || docItem.text}</span>
                        </label>
                        {docItem.stage && docItem.stage !== "Por confirmar" && (
                          <span className="chip shrink-0 border border-line bg-surface-subtle text-[11px] text-ink-muted">
                            {docItem.stage}
                          </span>
                        )}
                      </div>

                      {docItem.evidence && docItem.evidence.length > 0 && (
                        <details className="text-xs text-ink-muted">
                          <summary className="w-fit cursor-pointer font-medium text-forest">
                            Ver cita de las bases
                          </summary>
                          <div className="mt-1.5 space-y-1.5 border-l-2 border-line-mint pl-2.5">
                            {docItem.evidence.map((ev, i) => (
                              <blockquote key={i} className="space-y-0.5 text-ink-2">
                                <p>{ev.quote}</p>
                                <footer className="text-ink-muted">{ev.locator}</footer>
                              </blockquote>
                            ))}
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">
                {prepRunning
                  ? "Esperando la lectura de las bases…"
                  : "No se detectaron documentos adicionales sin formato en las bases."}
              </p>
            )}
          </div>

          {savedDrafts.length > 0 && (
            <div className="space-y-2.5 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-ink">Borradores guardados</h3>
                <span className="text-xs font-semibold text-ink-muted tabular-nums">
                  {savedDrafts.length}
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                Ediciones previas conservadas en esta convocatoria; no representan una exigencia automática de las bases.
              </p>
              <ul className="space-y-2" role="list">
                {savedDrafts.map((doc) => {
                  const isSelected = current?.id === doc.id;
                  return (
                    <li
                      key={doc.id}
                      className={`rounded-xl border transition-colors ${
                        isSelected
                          ? "border-forest bg-mint-light/50"
                          : "border-line bg-surface-subtle/40 hover:border-line-mint"
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelected(doc.id)}
                        className="w-full p-3 text-left"
                      >
                        <span className="block text-sm font-semibold text-ink wrap-anywhere">
                          {doc.title}
                        </span>
                        <span className="mt-1 inline-flex chip border border-line bg-white px-2 py-0.5 text-[11px] text-ink-2">
                          Guardado previamente
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {Boolean(data?.missing.length) && (
            <details className="border-t border-line pt-3 text-sm text-ink-muted">
              <summary className="w-fit cursor-pointer font-semibold text-ink-2">
                Datos por confirmar en las bases
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {data!.missing.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="inline-flex rounded-[10px] bg-surface-subtle p-1" role="group" aria-label="Modo del documento">
              <button
                type="button"
                aria-pressed={!editor}
                onClick={() => setEditor(false)}
                className={`min-h-9 rounded-[8px] px-3 text-sm font-semibold transition-colors ${
                  !editor ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"
                }`}
              >
                Vista del documento
              </button>
              <button
                type="button"
                aria-pressed={editor}
                onClick={() => setEditor(true)}
                className={`min-h-9 rounded-[8px] px-3 text-sm font-semibold transition-colors ${
                  editor ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"
                }`}
              >
                Editor
              </button>
            </div>

            <button
              type="button"
              disabled={!current}
              onClick={() => window.print()}
              className="btn-secondary min-h-9 px-3.5 py-2 text-sm"
            >
              Imprimir / PDF
            </button>

            {!dirty && current ? (
              <a
                href={`${base}/opportunities/${oppEncoded}/documents/${encodeURIComponent(current.id)}.docx`}
                className="btn-primary min-h-9 px-3.5 py-2 text-sm"
              >
                Descargar .docx
              </a>
            ) : (
              <span
                aria-disabled="true"
                className="btn-primary min-h-9 cursor-not-allowed px-3.5 py-2 text-sm opacity-60"
              >
                Descargar .docx
              </span>
            )}
          </div>

          {current ? (
            <>
              <div className="space-y-1.5 print:hidden">
                <h4 className="text-lg text-ink">{current.title}</h4>
                <p className="text-xs text-ink-muted">
                  {[current.stage, current.sourceTitle, current.locator].filter(Boolean).join(" · ")}
                  {current.partial && " · Lectura parcial: verifica el documento original."}
                  {(() => {
                    const sourceHref = portalTenderUrl(companyId, current.sourceUrl);
                    return sourceHref ? (
                      <>
                        {" "}
                        <a
                          href={sourceHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-forest underline underline-offset-2"
                        >
                          Ver documento fuente
                          <span className="sr-only"> (se abre en otra pestaña)</span>
                        </a>
                      </>
                    ) : null;
                  })()}
                </p>
              </div>

              {editor && (
                <div className="space-y-4 print:hidden">
                  <div className="space-y-3 rounded-xl border border-line-mint bg-mint-light/50 p-4">
                    <div className="space-y-0.5">
                      <strong className="text-sm text-ink">Asistente de edición con IA</strong>
                      <p className="text-xs text-ink-muted">
                        Describe los cambios que necesitas para ajustar este borrador.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        className="field py-2 text-sm"
                        placeholder="Ej: Completar con RUC, cambiar plazo a 15 días o ajustar precios"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !aiLoading) {
                            e.preventDefault();
                            void applyAiEdit();
                          }
                        }}
                        disabled={aiLoading}
                      />
                      <button
                        type="button"
                        onClick={() => void applyAiEdit()}
                        disabled={aiLoading || !aiPrompt.trim()}
                        className="btn-primary min-h-10 shrink-0 px-4 py-2 text-sm"
                      >
                        {aiLoading ? "Aplicando…" : "Aplicar con IA"}
                      </button>
                    </div>
                    {aiError && (
                      <p role="alert" className="text-xs font-medium text-red-700">
                        {aiError}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-ink-muted">Sugerencias:</span>
                      {AI_CHIPS.map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          disabled={aiLoading}
                          onClick={() => void applyAiEdit(chip.instruction)}
                          className="rounded-full border border-line-mint bg-white px-2.5 py-1 text-xs font-medium text-forest transition-colors hover:bg-mint-light"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="block space-y-1.5 text-sm">
                    <span className="font-semibold text-ink-2">Documento de trabajo</span>
                    <textarea
                      rows={18}
                      value={text}
                      maxLength={100000}
                      onChange={(e) => updateBody(e.target.value)}
                      className="field font-mono text-xs leading-relaxed"
                    />
                  </label>
                </div>
              )}

              <article
                className={`space-y-4 rounded-xl border border-line bg-white p-5 sm:p-6 ${editor ? "hidden print:block" : ""}`}
                aria-label="Vista del borrador"
              >
                <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
                  <div className="space-y-0.5">
                    <span className="block text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">
                      Borrador de trabajo
                    </span>
                    <small className="block text-xs text-ink-muted">
                      Verifica el formato oficial de las bases antes de firmar y presentar.
                    </small>
                  </div>
                  <span className="chip border border-amber-200 bg-amber-50 text-xs text-amber-900">
                    BORRADOR PARA REVISIÓN
                  </span>
                </header>

                <div className="grid gap-1 rounded-xl bg-surface-subtle px-4 py-3 text-xs text-ink-2 sm:grid-cols-3">
                  <div>
                    <span className="text-ink-muted">Entidad: </span>
                    <strong>{opportunity.alert.buyer}</strong>
                  </div>
                  <div>
                    <span className="text-ink-muted">Nomenclatura: </span>
                    <strong>{opportunity.alert.code}</strong>
                  </div>
                  <div>
                    <span className="text-ink-muted">Etapa: </span>
                    <strong>{current.stage}</strong>
                  </div>
                </div>

                <h5 className="text-center font-semibold text-ink">{current.title}</h5>

                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">
                  {text}
                </pre>

                <footer className="border-t border-line pt-4 text-center text-xs text-ink-muted">
                  <div className="mx-auto mt-6 max-w-xs border-t border-ink-faint pt-2">
                    <span className="block font-semibold text-ink-2">Firma y sello del Representante Legal</span>
                    <span>Confirmar formato vigente en las bases antes de presentar</span>
                  </div>
                </footer>
              </article>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              Selecciona un borrador de la lista para revisarlo, editarlo o descargarlo.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
