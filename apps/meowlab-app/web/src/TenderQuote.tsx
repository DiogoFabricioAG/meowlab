import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import {
  referenceFactor,
  tenderApi,
  useTenderWork,
  type MarketReference,
  type Quote,
  type Requirement,
  type TenderOpportunity,
  type Work,
} from "./tenderApi";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency }).format(value);

function safeHttps(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Native MeowLab quote workspace for one Tender Cat opportunity:
 * requirements from uploaded bases, market price references, unit conversion,
 * manual/archived quote lines and currency subtotals.
 */
export function TenderQuote({
  companyId,
  opportunity,
  work,
  onEdit,
}: {
  companyId: string;
  opportunity: TenderOpportunity;
  work: Work;
  onEdit: (value: Partial<Work>) => void;
}) {
  const { data, error, busy, refresh, analyze } = useTenderWork(companyId, opportunity.id);
  const [references, setReferences] = useState<Record<string, MarketReference[]>>({});
  const [searching, setSearching] = useState("");
  const [searchNote, setSearchNote] = useState("");
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({
    description: "",
    quantity: "",
    unit: "",
    price: "",
    priceUnit: "",
    factor: "",
    source: "",
    currency: "PEN" as "PEN" | "USD",
  });

  const quotes = work.quotes ?? [];
  const editorRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if ((editing || manual) && !editorRef.current?.open) {
      editorRef.current?.showModal();
    }
  }, [editing, manual]);

  function closeEditor() {
    if (editorRef.current?.open) editorRef.current.close();
    setEditing(null);
    setManual(false);
    setProblem("");
  }

  useEffect(() => {
    let active = true;
    void tenderApi<{ references: Record<string, MarketReference[]> }>(
      companyId,
      `/opportunities/${encodeURIComponent(opportunity.id)}/market`,
    )
      .then((value) => {
        if (active) setReferences(value.references ?? {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [companyId, opportunity.id, data?.generation]);

  const requirements = data?.requirements ?? [];
  const known = new Set(requirements.map((r) => r.id));
  const extra = quotes.filter((q) => !q.requirementId || !known.has(q.requirementId));

  const totals = new Map<string, number>();
  for (const quote of quotes) {
    if (quote.requirementId && !known.has(quote.requirementId) && !quote.requirementId.startsWith("manual-")) {
      continue;
    }
    const subtotal = Number(quote.quantity) * Number(quote.price);
    if (Number.isFinite(subtotal)) {
      totals.set(quote.currency, (totals.get(quote.currency) ?? 0) + subtotal);
    }
  }

  function openEditor(requirement: Requirement | null, reference?: MarketReference, previous?: Quote) {
    const quote = previous ?? (requirement ? quotes.find((q) => q.requirementId === requirement.id) : undefined);
    setEditing(requirement);
    setManual(!requirement);
    setProblem("");
    const unit = requirement?.unit ?? quote?.unit ?? "";
    const automatic = reference && requirement
      ? referenceFactor(unit, `${requirement.name} ${requirement.description}`, reference)
      : null;

    if (reference && requirement?.quantity && unit && automatic && reference.price && reference.currency) {
      const id = requirement.id;
      const line: Quote = {
        requirementId: id,
        description: requirement.name,
        quantity: requirement.quantity,
        unit,
        price: String(Number(reference.price) / automatic),
        inputPrice: reference.price,
        priceUnit: reference.unit ?? `${automatic} ${unit}`,
        conversionFactor: String(automatic),
        currency: reference.currency,
        source: reference.url,
      };
      onEdit({ quotes: [...quotes.filter((q) => q.requirementId !== id), line] });
      closeEditor();
      return;
    }

    const priceUnit = reference ? (reference.unit ?? "") : (quote?.priceUnit ?? unit);
    setForm({
      description: requirement?.name ?? quote?.description ?? "",
      quantity: requirement?.quantity ?? quote?.quantity ?? "",
      unit,
      price: reference?.price ?? quote?.inputPrice ?? quote?.price ?? "",
      priceUnit,
      factor: reference
        ? (automatic ? String(automatic) : "")
        : (quote?.conversionFactor ?? (unit && unit === priceUnit ? "1" : "")),
      source: reference?.url ?? quote?.source ?? "Precio ingresado por el usuario",
      currency: reference?.currency ?? quote?.currency ?? "PEN",
    });
  }

  async function searchOne(requirement: Requirement) {
    setSearching(requirement.id);
    setProblem("");
    try {
      const result = await tenderApi<{ references: MarketReference[] }>(
        companyId,
        `/opportunities/${encodeURIComponent(opportunity.id)}/requirements/${encodeURIComponent(requirement.id)}/market`,
        { method: "POST" },
      );
      setReferences((old) => ({ ...old, [requirement.id]: result.references ?? [] }));
    } catch (e) {
      setProblem(
        e instanceof Error && !/fetch|network/i.test(e.message)
          ? e.message
          : "No pudimos buscar precios. Puedes ingresar una cotización propia.",
      );
    } finally {
      setSearching("");
    }
  }

  async function searchAll() {
    setSearching("all");
    setProblem("");
    setSearchNote("");
    try {
      const result = await tenderApi<{
        references: Record<string, MarketReference[]>;
        priced: number;
        requested: number;
      }>(
        companyId,
        `/opportunities/${encodeURIComponent(opportunity.id)}/market`,
        { method: "POST" },
      );
      setReferences(result.references ?? {});
      setSearchNote(
        `Encontramos precios publicados para ${result.priced} de ${result.requested} partidas. Revisa presentación y condiciones antes de aplicarlos.`,
      );
    } catch (e) {
      setProblem(
        e instanceof Error && !/fetch|network/i.test(e.message)
          ? e.message
          : "No pudimos completar la búsqueda. Conservamos tus precios guardados.",
      );
    } finally {
      setSearching("");
    }
  }

  function apply() {
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    const factor = Number(form.factor);
    if (
      !form.description.trim()
      || !form.quantity
      || !form.price
      || !form.factor
      || quantity <= 0
      || price < 0
      || factor <= 0
      || ![quantity, price, factor].every(Number.isFinite)
      || !form.unit.trim()
      || !form.priceUnit.trim()
      || !form.source.trim()
    ) {
      setProblem("Indica el precio y a qué cantidad corresponde.");
      return;
    }
    const id = editing?.id ?? `manual-${crypto.randomUUID()}`;
    const line: Quote = {
      description: form.description,
      quantity: form.quantity,
      unit: form.unit,
      price: String(price / factor),
      inputPrice: form.price,
      priceUnit: form.priceUnit,
      conversionFactor: form.factor,
      currency: form.currency,
      source: form.source,
      requirementId: id,
    };
    onEdit({ quotes: [...quotes.filter((q) => q.requirementId !== id), line] });
    closeEditor();
  }

  const prepRunning = Boolean(data && ["queued", "running"].includes(data.status));

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="space-y-0.5">
            <h2 className="text-xl text-ink">Partidas y cotización</h2>
            <p className="text-sm text-ink-muted">
              {requirements.length
                ? `${requirements.length} ${requirements.length === 1 ? "partida identificada" : "partidas identificadas"} en tus bases`
                : "Las partidas aparecerán al analizar las bases de esta licitación."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void analyze()}
              className="btn-secondary min-h-10 px-4 py-2 text-sm"
            >
              {busy ? "Solicitando…" : "Analizar bases"}
            </button>
            <button
              type="button"
              disabled={!!searching || !requirements.length}
              onClick={() => void searchAll()}
              className="btn-primary min-h-10 px-4 py-2 text-sm"
            >
              {searching === "all" ? "Investigando precios…" : "Buscar precios con IA"}
            </button>
          </div>
        </header>

        {(error || (!(editing || manual) && problem)) && (
          <p role="alert" className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error || problem}
          </p>
        )}

        {searching && (
          <p role="status" className="mx-5 mt-4 rounded-xl border border-line-mint bg-mint-light px-4 py-3 text-sm text-forest">
            La IA está investigando precios publicados{searching === "all" ? " de todas las partidas" : " de esta partida"}. Puedes seguir revisando el expediente.
          </p>
        )}

        {searchNote && (
          <p role="status" className="mx-5 mt-4 rounded-xl border border-line-mint bg-mint-light px-4 py-3 text-sm text-ink-2">
            {searchNote}
          </p>
        )}

        {prepRunning && (
          <div role="status" className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-mint bg-surface-subtle px-4 py-3 text-sm text-ink-2">
            <span>Estamos leyendo las bases. Puedes conservar tus precios guardados mientras termina.</span>
            <button type="button" onClick={() => void refresh()} className="font-semibold text-forest underline-offset-4 hover:underline">
              Actualizar
            </button>
          </div>
        )}

        {!requirements.length ? (
          <p className="px-5 py-6 text-sm text-ink-muted">
            Todavía no hay partidas verificadas en el análisis. Usa «Analizar bases» o sube el archivo oficial si falta.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {requirements.map((r) => {
              const quote = quotes.find((q) => q.requirementId === r.id);
              const refs = references[r.id];
              return (
                <li key={r.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="font-semibold text-ink wrap-anywhere">{r.name}</div>
                      <p className="text-sm text-ink-muted">
                        Cantidad en bases:{" "}
                        <span className="font-medium text-ink-2 tabular-nums">
                          {r.quantity ? `${r.quantity} ${r.unit ?? ""}`.trim() : "Por confirmar"}
                        </span>
                      </p>
                      {r.evidence.length > 0 && (
                        <details className="text-sm text-ink-muted">
                          <summary className="w-fit cursor-pointer font-medium text-forest">
                            Ver respaldo en las bases
                          </summary>
                          <div className="mt-2 space-y-2 border-l-2 border-line-mint pl-3">
                            {r.evidence.map((ev, idx) => (
                              <blockquote key={idx} className="space-y-0.5 text-xs text-ink-2">
                                <p>{ev.quote}</p>
                                <footer className="text-ink-muted">{ev.locator}</footer>
                              </blockquote>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 lg:w-72 lg:items-end lg:text-right">
                      {quote ? (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-forest tabular-nums">
                            {money(Number(quote.price), quote.currency)} / {quote.unit}
                          </div>
                          <div className="text-xs text-ink-muted wrap-anywhere">{quote.source}</div>
                          <div className="text-sm font-semibold text-ink tabular-nums">
                            Subtotal: {money(Number(quote.quantity) * Number(quote.price), quote.currency)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-ink-muted">Pendiente de cotizar</span>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!!searching}
                          onClick={() => void searchOne(r)}
                          className="btn-secondary min-h-10 px-3.5 py-2 text-sm"
                        >
                          {searching === r.id ? "Buscando…" : "Buscar precio"}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditor(r)}
                          className="btn-primary min-h-10 px-3.5 py-2 text-sm"
                        >
                          Ingresar precio
                        </button>
                      </div>
                    </div>
                  </div>

                  {refs && (
                    <div className="space-y-2 rounded-xl border border-line bg-surface-subtle p-4">
                      {refs.length === 0 ? (
                        <p className="text-sm text-ink-muted">
                          No encontramos un precio publicado con respaldo para esta partida. Puedes ingresar el precio de tu proveedor.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {refs.map((ref, idx) => {
                            const refHref = safeHttps(ref.url);
                            return (
                              <li key={idx} className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 space-y-0.5">
                                  {refHref ? (
                                    <a
                                      href={refHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline"
                                    >
                                      <span className="wrap-anywhere">{ref.title}</span>
                                      <Icon name="external" className="h-3.5 w-3.5 shrink-0" />
                                    </a>
                                  ) : (
                                    <span className="text-sm font-semibold text-ink wrap-anywhere">{ref.title}</span>
                                  )}
                                  <p className="text-sm text-ink-2 tabular-nums">
                                    {ref.price && ref.currency
                                      ? money(Number(ref.price), ref.currency)
                                      : "Referencia anterior sin precio."}
                                    {ref.unit ? ` · Presentación: ${ref.unit}` : ""}
                                  </p>
                                </div>
                                {ref.price && (
                                  <button
                                    type="button"
                                    onClick={() => openEditor(r, ref)}
                                    className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs"
                                  >
                                    Usar como referencia
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-subtle px-5 py-3.5">
          <span className="text-xs text-ink-muted">Subtotal de los productos cotizados.</span>
          <div className="flex flex-wrap gap-4">
            {[...totals].map(([currency, total]) => (
              <strong key={currency} className="text-base font-semibold text-ink tabular-nums">
                Subtotal cotizado: {money(total, currency)}
              </strong>
            ))}
          </div>
        </footer>
      </section>

      {extra.length > 0 && (
        <details className="overflow-hidden rounded-2xl border border-line bg-white" open>
          <summary className="flex cursor-pointer items-center justify-between gap-3 border-b border-line px-5 py-3.5 font-semibold text-ink">
            <span>Cotizaciones anteriores y partidas guardadas ({extra.length})</span>
            <span className="chip border border-line bg-surface-subtle text-ink-muted">Archivadas / Manuales</span>
          </summary>
          <ul className="divide-y divide-line">
            {extra.map((q, idx) => (
              <li key={idx} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold text-ink wrap-anywhere">{q.description}</div>
                  <div className="text-sm text-ink-2 tabular-nums">
                    {q.quantity} {q.unit} · {money(Number(q.price), q.currency)}
                  </div>
                  <div className="text-xs text-ink-muted wrap-anywhere">
                    {q.requirementId && !q.requirementId.startsWith("manual-")
                      ? "De una lectura anterior; revisa su correspondencia con las bases actuales."
                      : q.source}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit({ quotes: quotes.filter((item) => item !== q) })}
                  className="btn-secondary min-h-10 shrink-0 px-3.5 py-2 text-sm"
                >
                  Quitar partida
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {(editing || manual) && (
        <dialog
          ref={editorRef}
          aria-labelledby="tender-price-title"
          onCancel={closeEditor}
          className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-line bg-white p-6 text-ink shadow-elevated backdrop:bg-black/40"
        >
          <div className="space-y-4">
            <h3 id="tender-price-title" className="text-2xl text-ink">
              {editing ? "Cotizar partida" : "Añadir partida"}
            </h3>
            {problem && (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {problem}
              </p>
            )}
            <div className="space-y-1 text-sm text-ink-muted">
              <p className="font-semibold text-ink wrap-anywhere">{form.description}</p>
              <p>
                {editing?.quantity && editing?.unit
                  ? `Las bases piden ${editing.quantity} ${editing.unit}.`
                  : "Falta confirmar cantidad y unidad de esta partida en las bases."}
              </p>
            </div>
            {(!editing?.quantity || !editing?.unit) && (
              <button
                type="button"
                onClick={() => {
                  closeEditor();
                  void analyze();
                }}
                className="btn-secondary min-h-10 px-4 py-2 text-sm"
              >
                Releer bases
              </button>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-ink-2">Precio</span>
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="any"
                  className="field py-2.5"
                  value={form.price}
                  onChange={(e) =>
                    setForm({ ...form, price: e.target.value, source: "Precio ingresado por el usuario" })
                  }
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-ink-2">Moneda</span>
                <select
                  className="field py-2.5"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value as "PEN" | "USD" })}
                >
                  <option value="PEN">Soles (PEN)</option>
                  <option value="USD">Dólares (USD)</option>
                </select>
              </label>

              <label className="block space-y-1 text-sm sm:col-span-2">
                <span className="font-semibold text-ink-2">
                  Este precio corresponde a ({form.unit || "unidades"})
                </span>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Cantidad del precio"
                    type="number"
                    min="0.000001"
                    step="any"
                    className="field py-2.5"
                    value={form.factor}
                    onChange={(e) =>
                      setForm({ ...form, factor: e.target.value, priceUnit: `${e.target.value} ${form.unit}` })
                    }
                  />
                  <span className="shrink-0 text-sm font-medium text-ink-muted">{form.unit}</span>
                </div>
              </label>
            </div>

            {Number(form.factor) > 0 && form.price && form.quantity && (
              <p className="rounded-xl bg-mint-light px-4 py-2.5 text-sm font-semibold text-forest tabular-nums">
                {money(Number(form.price) / Number(form.factor), form.currency)} por {form.unit} · Total:{" "}
                {money((Number(form.price) * Number(form.quantity)) / Number(form.factor), form.currency)}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" onClick={closeEditor} className="btn-secondary min-h-10 px-4 py-2 text-sm">
                Cancelar
              </button>
              <button
                type="button"
                disabled={!editing?.quantity || !editing?.unit}
                onClick={apply}
                className="btn-primary min-h-10 px-4 py-2 text-sm"
              >
                Aplicar precio
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
