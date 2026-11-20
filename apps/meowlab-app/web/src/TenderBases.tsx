import { useRef, useState } from "react";
import { Icon } from "./icons";
import { portalTenderUrl, tenderBase, type TenderOpportunity } from "./tenderApi";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 8;

/**
 * Upload, list, download and delete official PDF/DOCX bases for one opportunity
 * using native MeowLab portal endpoints under /api/companies/{companyId}/tender.
 */
export function TenderBases({
  companyId,
  opportunity,
  onOpportunityUpdated,
}: {
  companyId: string;
  opportunity: TenderOpportunity;
  onOpportunityUpdated: (updated: TenderOpportunity) => void;
}) {
  const [selected, setSelected] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const files = opportunity.uploadedBases ?? [];
  const base = tenderBase(companyId);
  const oppEncoded = encodeURIComponent(opportunity.id);

  function choose(incoming: File[]) {
    setError("");
    if (files.length + incoming.length > MAX_FILES || incoming.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      setError("Puedes tener hasta 8 archivos y 60 MB en total por licitación.");
      return;
    }
    setSelected(incoming);
  }

  async function upload() {
    setError("");
    if (!selected.length) return;
    if (selected.some((file) => file.size > MAX_FILE_BYTES || !/\.(pdf|docx)$/i.test(file.name))) {
      setError("Selecciona archivos PDF o Word (.docx), de hasta 15 MB cada uno.");
      return;
    }
    setBusy(true);
    let latest: TenderOpportunity | null = null;
    try {
      for (const file of selected) {
        const response = await fetch(
          `${base}/opportunities/${oppEncoded}/bases?filename=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
          },
        );
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          throw new Error(
            typeof data.detail === "string" ? data.detail : "No pudimos subir las bases. Vuelve a intentarlo.",
          );
        }
        latest = data as unknown as TenderOpportunity;
      }
      setSelected([]);
      if (latest) onOpportunityUpdated(latest);
    } catch (e) {
      const msg = e instanceof Error && !/fetch|network|typeerror/i.test(e.message)
        ? e.message
        : "No pudimos subir las bases. Revisa tu conexión y vuelve a intentarlo.";
      setError(msg);
      if (latest) onOpportunityUpdated(latest);
    } finally {
      setBusy(false);
    }
  }

  async function remove(fileId: string) {
    setDeletingId(fileId);
    setError("");
    try {
      const response = await fetch(
        `${base}/opportunities/${oppEncoded}/bases/${encodeURIComponent(fileId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "No pudimos eliminar las bases.");
      }
      setConfirmDeleteId(null);
      onOpportunityUpdated(data as unknown as TenderOpportunity);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos eliminar las bases. Vuelve a intentarlo.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {files.length > 0 && (
        <section
          aria-labelledby="tender-uploaded-bases-heading"
          className="overflow-hidden rounded-2xl border border-line bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 id="tender-uploaded-bases-heading" className="text-xl text-ink">
              Bases del expediente ({files.length})
            </h2>
          </div>
          <ul className="divide-y divide-line">
            {files.map((file) => {
              const downloadHref =
                portalTenderUrl(companyId, file.url) ??
                `${base}/opportunities/${oppEncoded}/bases/${encodeURIComponent(file.id)}`;
              const isConfirming = confirmDeleteId === file.id;
              const isDeleting = deletingId === file.id;
              return (
                <li key={file.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <a
                      href={downloadHref}
                      className="inline-flex min-h-11 items-center gap-2 font-semibold text-forest underline-offset-4 hover:underline"
                    >
                      <Icon name="invoice" className="h-4 w-4 shrink-0" />
                      <span className="wrap-anywhere">{file.title}</span>
                    </a>
                    <button
                      type="button"
                      disabled={busy || isDeleting}
                      onClick={() => setConfirmDeleteId(isConfirming ? null : file.id)}
                      className="btn-secondary min-h-10 px-4 py-2 text-sm sm:w-auto"
                    >
                      Eliminar bases
                    </button>
                  </div>
                  {isConfirming && (
                    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                      <p>
                        Se eliminará este archivo y su análisis de bases. Tus notas, cotizaciones y borradores se conservan.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void remove(file.id)}
                          className="btn-danger min-h-10 px-4 py-2 text-sm"
                        >
                          {isDeleting ? "Eliminando…" : "Eliminar archivo y análisis"}
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => setConfirmDeleteId(null)}
                          className="btn-secondary min-h-10 px-4 py-2 text-sm"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {files.length < MAX_FILES && (
        <section
          aria-labelledby="tender-upload-heading"
          className="space-y-4 rounded-2xl border border-line bg-white px-5 py-5 sm:px-6"
        >
          <div className="space-y-1">
            {files.length === 0 && (
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-forest">
                Antes de empezar
              </p>
            )}
            <h2 id="tender-upload-heading" className="text-xl text-ink">
              {files.length === 0 ? "Sube las bases de esta licitación" : "Adjuntar otro archivo de bases"}
            </h2>
            <p className="text-sm text-ink-muted">
              Adjunta las bases vigentes en PDF o Word (.docx) para preparar partidas, cotización y borradores del expediente. Las consultas rápidas de bases siguen disponibles en el WhatsApp de tu empresa.
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx"
            disabled={busy}
            aria-label="Seleccionar archivos de bases"
            className="sr-only"
            onChange={(e) => choose(Array.from(e.target.files ?? []))}
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) choose(Array.from(e.dataTransfer.files));
            }}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-5 py-8 text-center transition-colors ${
              dragging
                ? "border-forest bg-mint-light"
                : "border-line-mint bg-surface-subtle hover:border-forest hover:bg-mint-light/50"
            }`}
          >
            <Icon name="plus" className="h-7 w-7 text-forest" />
            <span className="font-semibold text-ink">Arrastra tus bases aquí o selecciona archivos</span>
            <span className="text-xs text-ink-muted">
              PDF o Word (.docx) · Hasta 15 MB por archivo · Máximo {MAX_FILES} archivos
            </span>
          </button>

          {selected.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface-subtle">
              {selected.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate font-medium text-ink">
                    {file.name}{" "}
                    <span className="text-ink-muted tabular-nums">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSelected((prev) => prev.filter((_, i) => i !== index))}
                    className="shrink-0 font-semibold text-forest underline-offset-4 hover:underline"
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={busy || !selected.length}
              onClick={() => void upload()}
              className="btn-primary min-h-11 w-full sm:w-auto"
            >
              {busy ? "Subiendo bases…" : "Subir bases"}
            </button>
            <p className="text-xs text-ink-muted">
              Comprueba que correspondan a esta licitación; si te equivocas puedes eliminarlas arriba.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
