import { useEffect, useMemo, useState } from "react";
import { fetchJson, type Membership } from "./auth-client";
import { Icon } from "./icons";

type Company = { id: string; name: string; legalName: string | null; ruc: string | null; environment: "beta" | "production" };
type Document = {
  id: string;
  kind: "invoice" | "credit_note";
  document_type: "01" | "03" | "07";
  number: string;
  issue_date: string | null;
  customer: { document_type: string | null; document_number: string | null; name: string | null };
  total: string;
  igv: string;
  status: string;
  sunat_message: string | null;
  related_number: string | null;
  files: { pdf: boolean; xml: boolean; cdr: boolean };
};
type Month = { month: string; documents: number; credit_notes: number; subtotal: string; igv: string; total: string };
type Guide = {
  id: string; series: string; correlative: number | null; status: string; message: string | null;
  invoice_number: string | null; customer: { ruc?: string; name?: string } | null; created_at: string; is_demo?: boolean;
  files: { xml: boolean; cdr: boolean };
};

const TYPE_LABEL: Record<string, string> = { "01": "Factura", "03": "Boleta", "07": "Nota de crédito" };
const FILE_LABEL = { pdf: "PDF", xml: "XML", cdr: "Constancia SUNAT" } as const;
const soles = (value: string | number) => `S/ ${Number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("es-PE", { month: "short" });
const monthLong = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("es-PE", { month: "long", year: "numeric" });
const needsAttention = (status: string) => status === "rejected" || status === "error" || status === "observed";

function StatusPill({ status }: { status: string }) {
  const tone = status === "accepted"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : needsAttention(status)
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";
  const label: Record<string, string> = {
    accepted: "Aceptada", rejected: "Rechazada", error: "Con error", processing: "En proceso",
    unknown: "Por verificar", pending: "Pendiente", draft: "Borrador", observed: "Observada",
  };
  return <span className={`chip whitespace-nowrap border ${tone}`}>{label[status] ?? status}</span>;
}

/** SUNAT's reason, visible next to the status: never only in a tooltip. */
function SunatReason({ status, message }: { status: string; message: string | null }) {
  if (!message || !needsAttention(status)) return null;
  return <p className="mt-1 text-sm text-red-800">{message}</p>;
}

function FileLinks({ tenantId, kind, id, number, files }: {
  tenantId: string; kind: string; id: string; number: string; files: Partial<Record<"pdf" | "xml" | "cdr", boolean>>;
}) {
  const links = (["pdf", "xml", "cdr"] as const).filter((type) => files[type]);
  if (!links.length) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-2">
      {links.map((type) => (
        <a
          key={type}
          href={`/api/invoicing/${encodeURIComponent(tenantId)}/files/${kind}/${id}/${type}`}
          target={type === "pdf" ? "_blank" : undefined}
          rel="noopener"
          aria-label={`${FILE_LABEL[type]} de ${number}${type === "pdf" ? " (se abre en otra pestaña)" : ""}`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-3 text-xs font-semibold uppercase text-forest hover:border-forest md:min-h-9"
        >
          {type}
        </a>
      ))}
    </span>
  );
}

const VIEWS = [["documents", "Comprobantes"], ["summary", "Resumen"], ["guides", "Guías"]] as const;

/**
 * Invoice Cat's detail: always the company chosen in the menu (never its own pick).
 * The list comes from what this account's linked WhatsApp may see.
 */
export function InvoicingPanel({ company: selected, onBack }: { company: Membership; onBack: () => void }) {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("documents");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void fetchJson<{ companies: Company[] }>("/api/invoicing/companies")
      .then((value) => (value ? setCompanies(value.companies) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  const company = companies?.find((item) => item.id === selected.id) ?? null;

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline">
        <span aria-hidden="true">←</span> Tus agentes
      </button>
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Invoice Cat</h1>
        <p className="text-lg text-ink-muted">
          Comprobantes de {selected.legalName ?? selected.name}
          {selected.ruc ? ` · RUC ${selected.ruc}` : ""}
          {company?.environment === "beta" ? " · modo de prueba, sin validez ante SUNAT" : ""}
        </p>
      </header>

      {failed && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos cargar tus comprobantes. Inténtalo en unos minutos.</p>}
      {!companies && !failed && <div className="h-40 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando" />}
      {companies && !company && (
        <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-2">
          Tu WhatsApp todavía no tiene acceso a los comprobantes de {selected.name}. Vincúlalo en Configuración o pide a quien
          administra la empresa una invitación con acceso a Invoice Cat.
        </p>
      )}

      {company && (
        <>
          <div className="grid w-full grid-cols-3 gap-1 rounded-[12px] bg-surface-subtle p-1 sm:w-fit" role="tablist" aria-label="Vistas de Invoice Cat">
            {VIEWS.map(([key, label]) => (
              <button
                key={key}
                id={`tab-${key}`}
                type="button"
                role="tab"
                aria-selected={view === key}
                aria-controls={`panel-${key}`}
                tabIndex={view === key ? 0 : -1}
                onClick={() => setView(key)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  const index = VIEWS.findIndex(([k]) => k === view);
                  const next = VIEWS[(index + (event.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length][0];
                  setView(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }}
                className={`min-h-11 rounded-[10px] px-3 text-sm font-semibold transition-colors sm:px-4 ${view === key ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div id={`panel-${view}`} role="tabpanel" aria-labelledby={`tab-${view}`}>
            {view === "documents" && <Documents key={company.id} tenantId={company.id} />}
            {view === "summary" && <Summary key={company.id} tenantId={company.id} />}
            {view === "guides" && <Guides key={company.id} tenantId={company.id} />}
          </div>
        </>
      )}
    </div>
  );
}

function Documents({ tenantId }: { tenantId: string }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: Document[]; meta: { total: number; per_page: number } } | null | "error">(null);

  useEffect(() => {
    setResult(null);
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const query = new URLSearchParams({ from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, page: String(page) });
    if (type) query.set("type", type);
    void fetchJson<{ data: Document[]; meta: { total: number; per_page: number } }>(`/api/invoicing/${encodeURIComponent(tenantId)}/documents?${query}`)
      .then((value) => setResult(value ?? "error"))
      .catch(() => setResult("error"));
  }, [tenantId, month, type, page]);

  const pages = result && result !== "error" ? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)) : 1;

  return (
    <section className="space-y-4 pt-2" aria-label="Comprobantes">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-ink-2">Mes</span>
          <input type="month" className="field" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-ink-2">Tipo</span>
          <select className="field" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">Todos</option>
            <option value="01">Facturas</option>
            <option value="03">Boletas</option>
            <option value="07">Notas de crédito</option>
          </select>
        </label>
      </div>

      {result === null && <div className="h-40 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando" />}
      {result === "error" && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos consultar FacturaYa. Inténtalo en unos minutos.</p>}
      {result && result !== "error" && (
        result.data.length === 0
          ? (
            <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
              No hay comprobantes en {monthLong(month)}. Los que emitas pidiéndoselo a Invoice Cat por WhatsApp aparecen aquí.
            </p>
          )
          : (
            <>
              {/* Phones: one card per document, with total, status and downloads in view. */}
              <ul className="space-y-3 md:hidden">
                {result.data.map((doc) => (
                  <li key={`${doc.kind}-${doc.id}`} className="rounded-2xl border border-line bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="whitespace-nowrap font-semibold text-ink">{doc.number}</div>
                        <div className="text-sm text-ink-muted">
                          {TYPE_LABEL[doc.document_type]} · {day(doc.issue_date)}
                        </div>
                      </div>
                      <div className={`whitespace-nowrap text-right font-semibold tabular-nums ${doc.document_type === "07" ? "text-red-800" : "text-ink"}`}>
                        {doc.document_type === "07" ? "−" : ""}{soles(doc.total)}
                      </div>
                    </div>
                    <div className="mt-2 truncate text-ink-2">{doc.customer.name ?? "Sin nombre"}</div>
                    <div className="mt-3"><StatusPill status={doc.status} /><SunatReason status={doc.status} message={doc.sunat_message} /></div>
                    <div className="mt-3"><FileLinks tenantId={tenantId} kind={doc.kind} id={doc.id} number={doc.number} files={doc.files} /></div>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">Comprobantes de {monthLong(month)}</caption>
                  <thead className="bg-surface-subtle text-left text-ink-2">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Fecha</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Comprobante</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Cliente</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                      <th scope="col" className="px-4 py-3 font-semibold">SUNAT</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Archivos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((doc) => (
                      <tr key={`${doc.kind}-${doc.id}`} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-4 py-3 text-ink-2">{day(doc.issue_date)}</td>
                        <td className="px-4 py-3">
                          <div className="whitespace-nowrap font-semibold text-ink">{doc.number}</div>
                          <div className="text-xs text-ink-muted">
                            {TYPE_LABEL[doc.document_type]}{doc.related_number ? ` de ${doc.related_number}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-ink">{doc.customer.name ?? "Sin nombre"}</div>
                          {doc.customer.document_number && <div className="text-xs text-ink-muted">{doc.customer.document_number}</div>}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${doc.document_type === "07" ? "text-red-800" : "text-ink"}`}>
                          {doc.document_type === "07" ? "−" : ""}{soles(doc.total)}
                        </td>
                        <td className="max-w-56 px-4 py-3"><StatusPill status={doc.status} /><SunatReason status={doc.status} message={doc.sunat_message} /></td>
                        <td className="px-4 py-3"><FileLinks tenantId={tenantId} kind={doc.kind} id={doc.id} number={doc.number} files={doc.files} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button type="button" className="btn-secondary min-h-11 px-3 py-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <span className="text-ink-muted">Página {page} de {pages}</span>
          <button type="button" className="btn-secondary min-h-11 px-3 py-2" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
        </div>
      )}
    </section>
  );
}

const CHART_HEIGHT = 170;

function Summary({ tenantId }: { tenantId: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [months, setMonths] = useState<Month[] | null | "error">(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    setMonths(null);
    void fetchJson<{ data: Month[] }>(`/api/invoicing/${encodeURIComponent(tenantId)}/summary?year=${year}`)
      .then((value) => setMonths(value ? value.data : "error"))
      .catch(() => setMonths("error"));
  }, [tenantId, year]);

  const totals = useMemo(() => {
    if (!months || months === "error") return null;
    return months.reduce((acc, m) => ({ total: acc.total + Number(m.total), igv: acc.igv + Number(m.igv), documents: acc.documents + m.documents }),
      { total: 0, igv: 0, documents: 0 });
  }, [months]);

  const thisYear = new Date().getFullYear();
  return (
    <section className="space-y-4 pt-2" aria-label="Resumen del año">
      <label className="block w-fit space-y-1.5">
        <span className="text-sm font-semibold text-ink-2">Año</span>
        <select className="field" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      {months === null && <div className="h-40 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando" />}
      {months === "error" && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos consultar FacturaYa. Inténtalo en unos minutos.</p>}
      {months && months !== "error" && totals && (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Ventas del año", value: soles(totals.total), note: "Aceptadas por SUNAT, menos notas de crédito" },
              { label: "IGV", value: soles(totals.igv), note: "Del mismo periodo" },
              { label: "Comprobantes aceptados", value: totals.documents.toLocaleString("es-PE"), note: "Facturas y boletas" },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-line bg-white p-5 shadow-soft">
                <dt className="text-sm font-semibold text-ink-muted">{tile.label}</dt>
                <dd className="mt-1 text-3xl font-bold tracking-tight text-ink tabular-nums">{tile.value}</dd>
                <dd className="mt-1 text-sm text-ink-muted">{tile.note}</dd>
              </div>
            ))}
          </dl>
          <MonthlyBars months={months} active={active} setActive={setActive} />
        </>
      )}
    </section>
  );
}

function MonthlyBars({ months, active, setActive }: { months: Month[]; active: number | null; setActive: (index: number | null) => void }) {
  const values = months.map((m) => Math.max(0, Number(m.total)));
  const max = Math.max(1, ...values);
  const slot = 56;
  const bar = 24;
  const width = months.length * slot;
  const y = (value: number) => CHART_HEIGHT - (value / max) * CHART_HEIGHT;
  const shown = active ?? values.reduce((best, value, index) => (value > values[best] ? index : best), 0);
  return (
    <div className="rounded-3xl border border-line bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Ventas por mes</h2>
        {/* Always visible, so touch screens read values too: the tapped month, or the best one. */}
        <p className="text-sm text-ink-muted" aria-live="polite">
          <span className="capitalize">{monthName(months[shown].month)}</span>:{" "}
          <span className="font-semibold text-ink tabular-nums">{soles(months[shown].total)}</span> · {months[shown].documents} comprobantes
        </p>
      </div>
      <div className="relative mt-4 overflow-x-auto" tabIndex={0} aria-label="Gráfico de ventas por mes, desplazable">
        <svg
          width={width}
          height={CHART_HEIGHT + 24}
          role="img"
          aria-label={`Ventas por mes: ${months.map((m) => `${monthName(m.month)} ${soles(m.total)}`).join(", ")}`}
          onMouseLeave={() => setActive(null)}
          className="text-forest"
        >
          <line x1={0} x2={width} y1={CHART_HEIGHT} y2={CHART_HEIGHT} className="stroke-line" strokeWidth={1} />
          {months.map((m, index) => {
            const value = values[index];
            const h = CHART_HEIGHT - y(value);
            const x = index * slot + (slot - bar) / 2;
            const r = Math.min(4, h / 2);
            return (
              <g key={m.month}>
                {value > 0 && (
                  <path
                    d={`M${x},${CHART_HEIGHT} V${CHART_HEIGHT - h + r} Q${x},${CHART_HEIGHT - h} ${x + r},${CHART_HEIGHT - h} H${x + bar - r} Q${x + bar},${CHART_HEIGHT - h} ${x + bar},${CHART_HEIGHT - h + r} V${CHART_HEIGHT} Z`}
                    fill="currentColor"
                    opacity={shown === index ? 1 : 0.4}
                  />
                )}
                <text x={index * slot + slot / 2} y={CHART_HEIGHT + 16} textAnchor="middle" fontSize={11} className="fill-ink-muted">{monthName(m.month)}</text>
                <rect
                  x={index * slot} y={0} width={slot} height={CHART_HEIGHT} fill="transparent"
                  onMouseEnter={() => setActive(index)} onClick={() => setActive(index)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Guides({ tenantId }: { tenantId: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: Guide[]; meta: { page: number; last_page: number } } | null | "error">(null);

  useEffect(() => {
    setResult(null);
    void fetchJson<{ data: Guide[]; meta: { page: number; last_page: number } }>(`/api/invoicing/${encodeURIComponent(tenantId)}/despatches?page=${page}`)
      .then((value) => setResult(value ?? "error"))
      .catch(() => setResult("error"));
  }, [tenantId, page]);

  if (result === null) return <div className="mt-2 h-40 animate-pulse rounded-2xl bg-surface-subtle motion-reduce:animate-none" aria-busy="true" aria-label="Cargando" />;
  if (result === "error") return <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos consultar FacturaYa. Inténtalo en unos minutos.</p>;
  if (!result.data.length) {
    return <p className="mt-2 rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">Todavía no hay guías de remisión. Pídele una a Invoice Cat cuando despaches mercadería.</p>;
  }
  const label = (guide: Guide) => (guide.correlative ? `${guide.series}-${String(guide.correlative).padStart(8, "0")}` : `${guide.series} (sin número)`);
  return (
    <section className="space-y-4 pt-2" aria-label="Guías de remisión">
      <ul className="space-y-3 md:hidden">
        {result.data.map((guide) => (
          <li key={guide.id} className="rounded-2xl border border-line bg-white p-4">
            <div className="whitespace-nowrap font-semibold text-ink">{label(guide)}</div>
            <div className="text-sm text-ink-muted">{day(guide.created_at)}{guide.invoice_number ? ` · ${guide.invoice_number}` : ""}{guide.is_demo ? " · prueba" : ""}</div>
            <div className="mt-2 truncate text-ink-2">{guide.customer?.name ?? "—"}</div>
            <div className="mt-3"><StatusPill status={guide.status} /><SunatReason status={guide.status} message={guide.message} /></div>
            <div className="mt-3"><FileLinks tenantId={tenantId} kind="despatch" id={guide.id} number={label(guide)} files={guide.files} /></div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Guías de remisión</caption>
          <thead className="bg-surface-subtle text-left text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Guía</th>
              <th scope="col" className="px-4 py-3 font-semibold">Factura</th>
              <th scope="col" className="px-4 py-3 font-semibold">Cliente</th>
              <th scope="col" className="px-4 py-3 font-semibold">SUNAT</th>
              <th scope="col" className="px-4 py-3 font-semibold">Archivos</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((guide) => (
              <tr key={guide.id} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  <div className="whitespace-nowrap font-semibold text-ink">{label(guide)}</div>
                  <div className="text-xs text-ink-muted">{day(guide.created_at)}{guide.is_demo ? " · prueba" : ""}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-2">{guide.invoice_number ?? "—"}</td>
                <td className="px-4 py-3 text-ink">{guide.customer?.name ?? "—"}</td>
                <td className="max-w-56 px-4 py-3"><StatusPill status={guide.status} /><SunatReason status={guide.status} message={guide.message} /></td>
                <td className="px-4 py-3"><FileLinks tenantId={tenantId} kind="despatch" id={guide.id} number={label(guide)} files={guide.files} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.meta.last_page > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button type="button" className="btn-secondary min-h-11 px-3 py-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <span className="text-ink-muted">Página {result.meta.page} de {result.meta.last_page}</span>
          <button type="button" className="btn-secondary min-h-11 px-3 py-2" disabled={page >= result.meta.last_page} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
        </div>
      )}
    </section>
  );
}
