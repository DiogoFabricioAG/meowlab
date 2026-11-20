import { useState } from "react";
import {
  tenderApi,
  tenderBase,
  useTenderWork,
  type TenderDocument,
  type TenderOpportunity,
  type Work,
} from "./tenderApi";

function fallbackCheckReason(stage?: string): string {
  const lower = (stage || "").toLowerCase();
  if (lower.includes("entrega") || lower.includes("pago")) {
    return "No se envía al postular, sino al entregar los bienes tras ganar la buena pro. Sin Guía de Remisión, copia de la Orden de Compra y Factura la entidad no da conformidad ni procesa el pago.";
  }
  if (lower.includes("calificación")) {
    return "Acredita la capacidad técnica o experiencia previa de tu empresa; el comité lo revisa para confirmar que puedes ejecutar el contrato.";
  }
  if (lower.includes("contrato")) {
    return "Se presenta únicamente si ganas la buena pro para formalizar la Orden de Compra o el contrato.";
  }
  if (lower.includes("admisibilidad") || lower.includes("oferta")) {
    return "Obligatorio al postular para que tu oferta sea admitida y evaluada. Si falta algún dato o no respeta el formato requerido, la propuesta queda descalificada.";
  }
  return "Exigencia directa de las bases del procedimiento; incluirlo correctamente evita observaciones o el rechazo de tu postulación.";
}

function fallbackDocReason(doc: TenderDocument): string {
  if (doc.reason) return doc.reason;
  const lower = `${doc.title} ${doc.stage}`.toLowerCase();
  if (lower.includes("índice") || lower.includes("organización")) {
    return "Ordena y folia toda tu propuesta (desde el folio 001) para que la entidad verifique de un vistazo que tu expediente de postulación está completo.";
  }
  if (lower.includes("cotización") || lower.includes("económica")) {
    return "Es el documento principal de tu oferta: fija el precio unitario, IGV y monto total en Soles por la totalidad de los ítems.";
  }
  if (lower.includes("especificaciones") || lower.includes("técnico")) {
    return "Compromete legalmente a tu empresa a entregar exactamente los bienes y características técnicas exigidas en las bases.";
  }
  if (lower.includes("plazo") || lower.includes("garantía") || lower.includes("ejecución")) {
    return "Garantiza que cumplirás el plazo de entrega y la garantía comercial exigidos tras emitirse la Orden de Compra.";
  }
  return "Requisito obligatorio de admisibilidad según las bases. Sin esta declaración jurada la entidad no puede admitir tu oferta.";
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
 * Native MeowLab dossier workspace: checklist of requirements, editable formal drafts,
 * AI-assisted draft editing, print/PDF and individual .docx / .zip exports.
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
  const { data, error, busy, refresh, analyze } = useTenderWork(companyId, opportunity.id);
  const [selected, setSelected] = useState("index");
  const [editor, setEditor] = useState(false);
  const [message, setMessage] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const documents = data?.documents ?? [];
  const current = documents.find((d) => d.id === selected) ?? documents[0];
  const text = current ? (work.documentEdits?.[current.id] ?? current.body) : "";
  const checks = work.checklist ?? [];
  const base = tenderBase(companyId);
  const oppEncoded = encodeURIComponent(opportunity.id);

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

  const readyCheckCount = data?.checks.filter((c) => checks.includes(c.id)).length ?? 0;
  const allChecksReady = Boolean(data?.checks.length && data.checks.every((c) => checks.includes(c.id)));
  const prepRunning = Boolean(data && ["queued", "running"].includes(data.status));

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-white px-5 py-4 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl text-ink">Borradores de la propuesta</h2>
            <p className="text-sm text-ink-muted">
              Revisa los requisitos de las bases, edita tus anexos y descarga los borradores.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {dirty ? (
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
              disabled={busy}
              onClick={() => void analyze()}
              className="btn-secondary min-h-10 px-4 py-2 text-sm"
            >
              {busy ? "Solicitando…" : "Analizar requisitos con IA"}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="btn-secondary min-h-10 px-4 py-2 text-sm"
            >
              Actualizar borradores
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
            Estamos leyendo los formatos de las bases. Los borradores aparecerán aquí al terminar.
          </p>
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]">
        <aside className="space-y-4 rounded-2xl border border-line bg-white p-5 print:hidden" aria-label="Requisitos de las bases">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg text-ink">Requisitos de las bases</h3>
            {Boolean(data?.checks.length) && (
              <span
                className={`chip border ${
                  allChecksReady
                    ? "border-line-mint bg-mint text-forest"
                    : "border-line bg-surface-subtle text-ink-2"
                } tabular-nums`}
              >
                {readyCheckCount}/{data!.checks.length} listos
              </span>
            )}
          </div>

          {data?.checks.length ? (
            <ul className="space-y-3">
              {data.checks.map((check) => {
                const checked = checks.includes(check.id);
                return (
                  <li key={check.id} className="space-y-2 rounded-xl border border-line bg-surface-subtle/60 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex cursor-pointer items-start gap-2.5 text-sm font-semibold text-ink">
                        <input
                          type="checkbox"
                          checked={checked}
                          className="mt-1 h-4 w-4 accent-forest"
                          onChange={(e) =>
                            onEdit({
                              checklist: e.target.checked
                                ? [...checks, check.id]
                                : checks.filter((id) => id !== check.id),
                            })
                          }
                        />
                        <span className="wrap-anywhere">{check.title || check.text}</span>
                      </label>
                      {check.stage && (
                        <span className="chip shrink-0 border border-line bg-white text-xs text-ink-muted">
                          {check.stage}
                        </span>
                      )}
                    </div>

                    {check.details && check.details.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-6 text-xs text-ink-2">
                        {check.details.map((detail, idx) => (
                          <li key={idx}>{detail}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-ink-2">{check.text}</p>
                    )}

                    {check.tableFormat && (
                      <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs">
                        <span className="font-semibold text-ink">Formato requerido: </span>
                        <span className="text-ink-2">{check.tableFormat}</span>
                      </div>
                    )}

                    <p className="text-xs text-ink-muted">
                      <strong className="text-ink-2">Por qué se exige:</strong>{" "}
                      {check.reason || fallbackCheckReason(check.stage)}
                    </p>

                    {check.evidence && check.evidence.length > 0 && (
                      <details className="text-xs text-ink-muted">
                        <summary className="w-fit cursor-pointer font-medium text-forest">
                          Ver fuente de las bases
                        </summary>
                        <div className="mt-1.5 space-y-1.5 border-l-2 border-line-mint pl-2.5">
                          {check.evidence.map((ev, i) => (
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
              Los requisitos se confirmarán al leer las bases. No añadimos anexos genéricos al expediente.
            </p>
          )}

          {Boolean(data?.missing.length) && (
            <details className="text-sm text-ink-muted">
              <summary className="w-fit cursor-pointer font-semibold text-ink-2">Datos por confirmar</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {data!.missing.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>

        <section className="space-y-4 rounded-2xl border border-line bg-white p-5">
          <div className="space-y-3 print:hidden">
            <h3 className="text-lg text-ink">Expediente de postulación</h3>

            {documents.length > 0 && (
              <details className="rounded-xl border border-line bg-surface-subtle px-4 py-3 text-sm">
                <summary className="cursor-pointer font-semibold text-forest">
                  ¿Por qué debes enviar estos {documents.length} documentos en tu expediente?
                </summary>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-ink-2">
                  {documents.map((doc) => (
                    <li key={doc.id}>
                      <strong>{doc.title}:</strong> {fallbackDocReason(doc)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-2">
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

            {documents.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Borradores del expediente">
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    aria-pressed={current?.id === doc.id}
                    onClick={() => setSelected(doc.id)}
                    className={`min-h-9 rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      current?.id === doc.id
                        ? "border-forest bg-mint-light text-forest"
                        : "border-line bg-white text-ink-muted hover:text-ink"
                    }`}
                  >
                    {doc.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {current ? (
            <>
              <div className="space-y-2 print:hidden">
                <h4 className="text-lg text-ink">{current.title}</h4>
                <p className="text-xs text-ink-muted">
                  {current.stage}.{" "}
                  {current.partial
                    ? "La lectura es parcial: revisa el original antes de usar este borrador."
                    : "Borrador editable basado en el texto de tus bases."}{" "}
                  Revisa el formato original y completa los datos antes de firmar.
                </p>
                <p className="rounded-xl bg-surface-subtle px-3.5 py-2.5 text-xs text-ink-2">
                  <strong>Motivo en tu expediente:</strong> {fallbackDocReason(current)}
                </p>
              </div>

              {editor && (
                <div className="space-y-4 print:hidden">
                  <div className="space-y-3 rounded-xl border border-line-mint bg-mint-light/50 p-4">
                    <div className="space-y-0.5">
                      <strong className="text-sm text-ink">Asistente de edición con IA</strong>
                      <p className="text-xs text-ink-muted">
                        Describe los cambios que necesitas para ajustar este borrador oficial.
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
                      Sistema Electrónico de Contrataciones del Estado — SEACE
                    </span>
                    <small className="block text-xs text-ink-muted">
                      Ley N° 32069, Ley General de Contrataciones Públicas y su Reglamento
                    </small>
                  </div>
                  <span className="chip border border-amber-200 bg-amber-50 text-xs text-amber-900">
                    BORRADOR PARA REVISIÓN — NO OFICIAL
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
                    <span>Verificar formato oficial y completar datos antes de presentar en SEACE</span>
                  </div>
                </footer>
              </article>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              Los borradores se preparan con los formatos de las bases. Puedes iniciar la lectura con «Analizar requisitos con IA».
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
