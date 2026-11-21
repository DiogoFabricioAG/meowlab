import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
import { Icon } from "./icons";
import { tenderBase, type TenderOpportunity } from "./tenderApi";

export function TenderBases({
  companyId,
  opportunity,
  onOpportunityUpdated,
  disabled = false,
}: {
  companyId: string;
  opportunity: TenderOpportunity;
  onOpportunityUpdated: (updated: TenderOpportunity) => void;
  disabled?: boolean;
}) {
  const [target, setTarget] = useState<TenderOpportunity["uploadedBases"][number] | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const files = opportunity.uploadedBases ?? [];
  const url = `${tenderBase(companyId)}/opportunities/${encodeURIComponent(opportunity.id)}/bases`;

  useEffect(() => {
    if (target && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [target]);

  function open(file: typeof target) {
    setSelected(null);
    setError("");
    setTarget(file);
  }

  async function upload(file: File) {
    if (!/\.(pdf|docx)$/i.test(file.name) || !file.size || file.size > 15 * 1024 * 1024) {
      setError("Elige un PDF o DOCX de hasta 15 MB.");
      return;
    }
    const query = new URLSearchParams({ filename: file.name });
    if (target) query.set("replace", target.id);
    setError("");
    setBusy(true);
    try {
      const response = await apiFetch(`${url}?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "No pudimos guardar las bases. Inténtalo de nuevo.");
      }
      dialogRef.current?.close();
      setSelected(null);
      onOpportunityUpdated(data as TenderOpportunity);
    } catch (err) {
      setError(err instanceof Error && !/fetch|network/i.test(err.message)
        ? err.message
        : "La conexión se interrumpió. Vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line px-5 py-3.5">
      {files.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line" aria-label="Bases del expediente">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
              <a
                className="btn-secondary inline-flex min-h-10 items-center gap-2 px-3.5 py-2 text-sm"
                href={`${url}/${encodeURIComponent(file.id)}`}
              >
                <Icon name="invoice" className="h-4 w-4 shrink-0" />
                Descargar bases
                <span className="sr-only"> · {file.title}</span>
              </a>
              <span className="order-last min-w-0 w-full text-sm text-ink-muted sm:order-none sm:w-auto sm:flex-1">{file.title}</span>
              <button
                type="button"
                disabled={disabled || busy}
                className="min-h-10 rounded-md px-1.5 text-sm font-semibold text-forest underline-offset-4 hover:underline disabled:opacity-60"
                onClick={() => open(file)}
              >
                Reemplazar
                <span className="sr-only"> · {file.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">El expediente está a la espera de las bases.</span>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <button type="button" className="btn-secondary min-h-10 px-3.5 py-2 text-sm"
            disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "Subiendo bases…" : "Subir bases"}
          </button>
          {error && <p role="alert" className="w-full text-sm text-red-800">{error}</p>}
        </div>
      )}

      {target && (
        <dialog
          ref={dialogRef}
          aria-labelledby="tender-replace-title"
          className="m-auto w-[min(100%-2rem,30rem)] rounded-2xl border border-line bg-white p-5 shadow-elevated backdrop:bg-slate-900/40"
          onCancel={(event) => { if (busy) event.preventDefault(); }}
          onClose={() => open(null)}
        >
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (selected && !busy) void upload(selected); }}>
            <h3 id="tender-replace-title" className="text-xl text-ink">Reemplazar bases</h3>
            <p className="text-sm text-ink-muted">El nuevo archivo reemplazará a <strong>{target.title}</strong> y se analizará automáticamente.</p>
            <label className="block space-y-1 text-sm font-medium text-ink">
              <span>Nuevo archivo PDF o DOCX</span>
              <input type="file" accept=".pdf,.docx" className="field min-w-0 text-sm" disabled={busy}
                onChange={(event) => setSelected(event.target.files?.[0] ?? null)} />
            </label>
            {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => dialogRef.current?.close()}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={!selected || busy}>{busy ? "Reemplazando…" : "Reemplazar bases"}</button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
