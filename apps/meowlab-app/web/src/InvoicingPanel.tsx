import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "./auth-client";

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
const soles = (value: string | number) => `S/ ${Number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("es-PE", { month: "short" });

function StatusPill({ status, message }: { status: string; message?: string | null }) {
  const tone = status === "accepted"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : status === "rejected" || status === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";
  const label: Record<string, string> = {
    accepted: "Aceptada", rejected: "Rechazada", error: "Con error", processing: "En proceso",
    unknown: "Por verificar", pending: "Pendiente", draft: "Borrador", observed: "Observada",
  };
  return <span className={`chip border ${tone}`} title={message ?? undefined}>{label[status] ?? status}</span>;
}

function FileLinks({ tenantId, kind, id, files }: { tenantId: string; kind: string; id: string; files: Partial<Record<"pdf" | "xml" | "cdr", boolean>> }) {
  const links = (["pdf", "xml", "cdr"] as const).filter((type) => files[type]);
  if (!links.length) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex gap-2">
      {links.map((type) => (
        <a
          key={type}
          href={`/api/invoicing/${encodeURIComponent(tenantId)}/files/${kind}/${id}/${type}`}
          target={type === "pdf" ? "_blank" : undefined}
          rel="noopener"
          className="rounded-md border border-line px-2 py-0.5 text-xs font-semibold uppercase text-forest hover:border-forest"
        >
          {type}
        </a>
      ))}
    </span>
  );
}

export function InvoicingPanel() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [companyId, setCompanyId] = useState<string>("");
  const [view, setView] = useState<"documents" | "summary" | "guides">("documents");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void fetchJson<{ companies: Company[] }>("/api/invoicing/companies").then((value) => {
      if (!value) return setFailed(true);
      setCompanies(value.companies);
      if (value.companies[0]) setCompanyId(value.companies[0].id);
    });
  }, []);

  if (failed) return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos cargar tus empresas. Inténtalo en unos minutos.</p>;
  if (!companies) return <p className="text-ink-muted" aria-busy="true">Cargando tus empresas…</p>;
  if (!companies.length) {
    return (
      <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-2">
        Tu WhatsApp vinculado todavía no es miembro de ninguna empresa con facturación electrónica. Pídele al equipo de MeowLab que
        agregue tu número a tu empresa.
      </p>
    );
  }
  const company = companies.find((item) => item.id === companyId) ?? companies[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-ink">Facturación</h2>
          <p className="text-ink-muted">
            {company.legalName ?? company.name}
            {company.ruc ? ` · RUC ${company.ruc}` : ""}
            {company.environment === "beta" ? " · ambiente de pruebas SUNAT" : ""}
          </p>
        </div>
        {companies.length > 1 && (
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-ink-2">Empresa</span>
            <select className="field sm:w-72" value={company.id} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((item) => <option key={item.id} value={item.id}>{item.legalName ?? item.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="grid w-fit grid-cols-3 gap-1 rounded-[12px] bg-surface-subtle p-1" role="tablist">
        {([["documents", "Comprobantes"], ["summary", "Resumen"], ["guides", "Guías"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`rounded-[10px] px-4 py-2 text-sm font-semibold transition-colors ${view === key ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "documents" && <Documents key={company.id} tenantId={company.id} />}
      {view === "summary" && <Summary key={company.id} tenantId={company.id} />}
      {view === "guides" && <Guides key={company.id} tenantId={company.id} />}
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
      .then((value) => setResult(value ?? "error"));
  }, [tenantId, month, type, page]);

  const pages = result && result !== "error" ? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)) : 1;

  return (
    <section className="space-y-4">
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

      {result === null && <p className="text-ink-muted" aria-busy="true">Cargando comprobantes…</p>}
      {result === "error" && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos consultar FacturaYa. Inténtalo en unos minutos.</p>}
      {result && result !== "error" && (
        result.data.length === 0
          ? <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">No hay comprobantes en este mes.</p>
          : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface-subtle text-left text-ink-2">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 font-semibold">Comprobante</th>
                    <th className="px-4 py-3 font-semibold">Cliente</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">SUNAT</th>
                    <th className="px-4 py-3 font-semibold">Archivos</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((doc) => (
                    <tr key={`${doc.kind}-${doc.id}`} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">{day(doc.issue_date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{doc.number}</div>
                        <div className="text-xs text-ink-muted">
                          {TYPE_LABEL[doc.document_type]}{doc.related_number ? ` de ${doc.related_number}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-ink">{doc.customer.name ?? "Sin nombre"}</div>
                        {doc.customer.document_number && <div className="text-xs text-ink-muted">{doc.customer.document_number}</div>}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold ${doc.document_type === "07" ? "text-red-800" : "text-ink"}`}>
                        {doc.document_type === "07" ? "−" : ""}{soles(doc.total)}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={doc.status} message={doc.sunat_message} /></td>
                      <td className="px-4 py-3"><FileLinks tenantId={tenantId} kind={doc.kind} id={doc.id} files={doc.files} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button type="button" className="btn-secondary px-3 py-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <span className="text-ink-muted">Página {page} de {pages}</span>
          <button type="button" className="btn-secondary px-3 py-2" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
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
      .then((value) => setMonths(value ? value.data : "error"));
  }, [tenantId, year]);

  const totals = useMemo(() => {
    if (!months || months === "error") return null;
    return months.reduce((acc, m) => ({ total: acc.total + Number(m.total), igv: acc.igv + Number(m.igv), documents: acc.documents + m.documents }),
      { total: 0, igv: 0, documents: 0 });
  }, [months]);

  const thisYear = new Date().getFullYear();
  return (
    <section className="space-y-4">
      <label className="block w-fit space-y-1.5">
        <span className="text-sm font-semibold text-ink-2">Año</span>
        <select className="field" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      {months === null && <p className="text-ink-muted" aria-busy="true">Cargando resumen…</p>}
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
                <dd className="mt-1 font-title text-3xl font-bold tracking-tight text-ink tabular-nums">{tile.value}</dd>
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
  return (
    <div className="rounded-3xl border border-line bg-white p-6 shadow-card">
      <h3 className="text-lg font-bold text-ink">Ventas por mes</h3>
      <div className="relative mt-4 overflow-x-auto">
        <div className="relative" style={{ width }}>
          <svg
            width={width}
            height={CHART_HEIGHT + 24}
            role="img"
            aria-label={`Ventas por mes: ${months.map((m) => `${monthName(m.month)} ${soles(m.total)}`).join(", ")}`}
            onMouseLeave={() => setActive(null)}
          >
            <line x1={0} x2={width} y1={CHART_HEIGHT} y2={CHART_HEIGHT} stroke="#e8ece9" strokeWidth={1} />
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
                      fill="#0c493c"
                      opacity={active === null || active === index ? 1 : 0.35}
                    />
                  )}
                  <text x={index * slot + slot / 2} y={CHART_HEIGHT + 16} textAnchor="middle" fontSize={11} fill="#46544f">{monthName(m.month)}</text>
                  <rect
                    x={index * slot} y={0} width={slot} height={CHART_HEIGHT} fill="transparent" tabIndex={0}
                    onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}
                    aria-label={`${monthName(m.month)}: ${soles(m.total)}`}
                  />
                </g>
              );
            })}
          </svg>
          {active !== null && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-3 py-2 text-sm text-white shadow-elevated"
              style={{ left: active * slot + slot / 2, top: Math.max(0, y(values[active]) - 8) }}
              role="status"
            >
              <div className="font-semibold tabular-nums">{soles(months[active].total)}</div>
              <div className="text-xs text-ink-faint">
                {months[active].documents} comprobantes{months[active].credit_notes ? ` · ${months[active].credit_notes} notas` : ""}
              </div>
            </div>
          )}
        </div>
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
      .then((value) => setResult(value ?? "error"));
  }, [tenantId, page]);

  if (result === null) return <p className="text-ink-muted" aria-busy="true">Cargando guías…</p>;
  if (result === "error") return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">No pudimos consultar FacturaYa. Inténtalo en unos minutos.</p>;
  if (!result.data.length) return <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">Todavía no hay guías de remisión.</p>;
  return (
    <section className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-subtle text-left text-ink-2">
            <tr>
              <th className="px-4 py-3 font-semibold">Guía</th>
              <th className="px-4 py-3 font-semibold">Factura</th>
              <th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">SUNAT</th>
              <th className="px-4 py-3 font-semibold">Archivos</th>
            </tr>
          </thead>
          <tbody>
            {result.data.map((guide) => (
              <tr key={guide.id} className="border-t border-line align-top">
                <td className="px-4 py-3">
                  <div className="font-semibold text-ink">
                    {guide.correlative ? `${guide.series}-${String(guide.correlative).padStart(8, "0")}` : `${guide.series} (sin número)`}
                  </div>
                  <div className="text-xs text-ink-muted">{day(guide.created_at)}{guide.is_demo ? " · prueba" : ""}</div>
                </td>
                <td className="px-4 py-3 text-ink-2">{guide.invoice_number ?? "—"}</td>
                <td className="px-4 py-3 text-ink">{guide.customer?.name ?? "—"}</td>
                <td className="px-4 py-3"><StatusPill status={guide.status} message={guide.message} /></td>
                <td className="px-4 py-3"><FileLinks tenantId={tenantId} kind="despatch" id={guide.id} files={guide.files} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.meta.last_page > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button type="button" className="btn-secondary px-3 py-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <span className="text-ink-muted">Página {result.meta.page} de {result.meta.last_page}</span>
          <button type="button" className="btn-secondary px-3 py-2" disabled={page >= result.meta.last_page} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
        </div>
      )}
    </section>
  );
}
