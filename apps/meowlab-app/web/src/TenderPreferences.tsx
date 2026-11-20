import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./tender-preferences.css";

type Settings = {
  description: string;
  coverage: string;
  topics: string[];
  excludedTopics: string[];
  searchPreferences: {
    regions: string[];
    entity: string;
    minAmount: number | null;
    maxAmount: number | null;
    currency: "PEN" | "USD" | "EUR";
  };
};
type Snapshot = { settings: Settings; version: string; regions: string[] };
type Form = {
  description: string;
  coverage: string;
  topics: string;
  excludedTopics: string;
  regions: string[];
  entity: string;
  minAmount: string;
  maxAmount: string;
  currency: "PEN" | "USD" | "EUR";
};
const empty: Settings = {
  description: "",
  coverage: "",
  topics: [],
  excludedTopics: [],
  searchPreferences: {
    regions: [],
    entity: "",
    minAmount: null,
    maxAmount: null,
    currency: "PEN",
  },
};
function formFor(s: Settings): Form {
  const p = s.searchPreferences;
  return {
    description: s.description,
    coverage: s.coverage,
    topics: s.topics.join("\n"),
    excludedTopics: s.excludedTopics.join("\n"),
    regions: p.regions,
    entity: p.entity,
    minAmount: p.minAmount === null ? "" : String(p.minAmount),
    maxAmount: p.maxAmount === null ? "" : String(p.maxAmount),
    currency: p.currency,
  };
}
const listOf = (value: string) => [
  ...new Set(
    value
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
class BusinessError extends Error {
  readonly status: number;
  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.status = status;
  }
}
async function businessApi(
  company: string,
  method: "GET" | "PUT",
  signal?: AbortSignal,
  body?: unknown,
): Promise<Snapshot> {
  const response = await fetch("/api/companies/" + encodeURIComponent(company) + "/tender/business", {
    method,
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new BusinessError(
      typeof data.detail === "string"
        ? data.detail
        : "No pudimos guardar los ajustes. Revisa los campos e inténtalo de nuevo.",
      response.status,
    );
  if (
    !data.settings ||
    !Array.isArray(data.settings.topics) ||
    !Array.isArray(data.regions) ||
    typeof data.version !== "string"
  )
    throw Error("No pudimos cargar tu negocio. Vuelve a intentarlo.");
  return data;
}

export function TenderPreferences({ company }: { company: string }) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [base, setBase] = useState<Snapshot | null>(null);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [form, setForm] = useState<Form>(() => formFor(empty));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const mounted = useRef(true);
  const dirty =
    !!base && JSON.stringify(form) !== JSON.stringify(formFor(base.settings));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const changedElsewhere =
    !!base && !!latest && base.version !== latest.version;
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const data = await businessApi(company, "GET", controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setLatest(data);
      if (!dirtyRef.current) {
        setBase(data);
        setForm(formFor(data.settings));
      }
      if (!dirtyRef.current) setError("");
    } catch (e) {
      if (!controller.signal.aborted && mounted.current)
        setError(
          e instanceof Error ? e.message : "No pudimos cargar tu negocio.",
        );
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, [company]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [load]);
  function parseTagList(raw: string) {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const part of raw.split(/[\n,;]+/)) {
      const clean = part.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(clean);
    }
    return items;
  }
  function resizeTextareas() {
    const node = dialog.current;
    if (!node) return;
    node
      .querySelectorAll<HTMLTextAreaElement>("textarea.rw-business-autogrow")
      .forEach((area) => {
        area.style.height = "auto";
        area.style.height = `${Math.max(area.scrollHeight, 68)}px`;
      });
  }
  useEffect(() => {
    const node = dialog.current;
    if (editing) {
      if (node && !node.open) node.showModal();
      const body = node?.querySelector(".rw-business-modal-body");
      if (body) body.scrollTop = 0;
      void load();
    } else if (node?.open) node.close();
  }, [editing, load]);
  useEffect(() => {
    if (!editing) return;
    resizeTextareas();
    const raf = window.requestAnimationFrame(resizeTextareas);
    return () => window.cancelAnimationFrame(raf);
  }, [editing, base, form.description, form.topics, form.excludedTopics]);
  function edit(value: Partial<Form>) {
    setForm((previous) => ({ ...previous, ...value }));
    setError("");
  }
  function removeTagItem(field: "topics" | "excludedTopics", index: number) {
    const next = parseTagList(form[field]).filter((_, i) => i !== index);
    edit({ [field]: next.join("\n") });
  }
  const topicItems = parseTagList(form.topics);
  const excludedItems = parseTagList(form.excludedTopics);
  function restore() {
    if (latest) {
      setBase(latest);
      setForm(formFor(latest.settings));
    }
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!base || saving) return;
    const low = form.minAmount === "" ? null : Number(form.minAmount),
      high = form.maxAmount === "" ? null : Number(form.maxAmount);
    if (
      (low !== null && (!Number.isFinite(low) || low < 0)) ||
      (high !== null && (!Number.isFinite(high) || high < 0)) ||
      (low !== null && high !== null && low > high)
    ) {
      setError("Revisa los montos: el mínimo no puede superar al máximo.");
      return;
    }
    setSaving(true);
    setError("");
    request.current?.abort();
    try {
      const result = await businessApi(company, "PUT", undefined, {
        version: base.version,
        description: form.description,
        coverage: form.coverage,
        topics: listOf(form.topics),
        excludedTopics: listOf(form.excludedTopics),
        searchPreferences: {
          regions: form.regions,
          entity: form.entity,
          minAmount: low,
          maxAmount: high,
          currency: form.currency,
        },
      });
      if (!mounted.current) return;
      setBase(result);
      setLatest(result);
      setForm(formFor(result.settings));
      setNotice(
        "Ajustes guardados. Tender Cat los usar\u00e1 en la b\u00fasqueda autom\u00e1tica.",
      );
      setEditing(false);
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if (e instanceof BusinessError && e.status === 409) void load();
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  function closeModal() {
    if (saving) return;
    if (
      dirty &&
      !window.confirm(
        "Hay ajustes sin guardar. \u00bfQuieres cerrar sin guardarlos?",
      )
    )
      return;
    restore();
    setEditing(false);
  }
  return (
    <div className="my-4">
      <button type="button" className="btn-secondary" onClick={() => { setNotice(""); setEditing(true); }}>Intereses de búsqueda</button>
      {notice && <p role="status" className="mt-2 text-sm text-ink-muted">{notice}</p>}
    <dialog
      ref={dialog}
      id="business-settings"
      className="rw-business-modal"
      aria-labelledby="business-settings-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]',
          ),
        ].filter((node) => node.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        closeModal();
      }}
      onClose={() => setEditing(false)}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          closeModal();
      }}
    >
      <header className="rw-business-modal-header">
        <div>
          <h2 id="business-settings-title">Ajustes del negocio</h2>
          <p>
            Configura las oportunidades que recibes. El asistente comparte estos
            ajustes.
          </p>
        </div>
        <button
          type="button"
          className="rw-business-close"
          aria-label="Cerrar ajustes"
          onClick={closeModal}
          disabled={saving}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>
      <form
        className="rw-business-modal-form"
        onSubmit={(event) => void save(event)}
      >
        <div className="rw-business-modal-body">
          {loading && <p role="status">Cargando tu negocio…</p>}
          {error && (
            <div className="rw-business-feedback" role="alert">
              <p>{error}</p>
              {!base && (
                <button type="button" onClick={() => void load()}>
                  Volver a intentar
                </button>
              )}
            </div>
          )}
          {base && (
            <>
              {changedElsewhere && (
                <div className="rw-business-feedback" role="status">
                  <p>
                    El negocio se actualizó en la conversación o en otra
                    ventana. Conservamos lo que estás editando.
                  </p>
                  <button type="button" onClick={restore}>
                    Usar la versión guardada
                  </button>
                </div>
              )}
              <fieldset disabled={saving} className="rw-business-fields">
                <section className="rw-business-card">
                  <div className="rw-business-field">
                    <label htmlFor="business-description">
                      Qué hace tu negocio
                    </label>
                    <textarea
                      id="business-description"
                      className="rw-business-autogrow"
                      value={form.description}
                      rows={2}
                      maxLength={6000}
                      placeholder="Describe los productos o servicios que comercializas, tu capacidad y condiciones habituales."
                      onChange={(e) => {
                        edit({ description: e.target.value });
                      }}
                    />
                  </div>
                  <div className="rw-business-field">
                    <label htmlFor="business-coverage">Dónde puedes atender</label>
                    <input
                      id="business-coverage"
                      value={form.coverage}
                      maxLength={1000}
                      placeholder="Ej. Lima Metropolitana, Callao o todo el Perú"
                      onChange={(e) => edit({ coverage: e.target.value })}
                    />
                  </div>
                </section>

                <div className="rw-business-columns">
                  <section className="rw-business-card">
                    <div className="rw-business-field-head">
                      <label htmlFor="business-topics">
                        Productos o servicios que te interesan
                      </label>
                      {topicItems.length > 0 && (
                        <span className="rw-business-count">
                          {topicItems.length}
                        </span>
                      )}
                    </div>
                    <textarea
                      id="business-topics"
                      className="rw-business-autogrow"
                      value={form.topics}
                      rows={2}
                      placeholder="Ej. cables eléctricos, focos, enchufes, herramientas"
                      onChange={(e) => edit({ topics: e.target.value })}
                      aria-describedby="business-topics-hint"
                    />
                    <small id="business-topics-hint">
                      Separa los productos con comas o saltos de línea.
                    </small>
                    {topicItems.length > 0 && (
                      <ul
                        className="rw-business-chips"
                        aria-label="Lista de intereses"
                      >
                        {topicItems.map((item, idx) => (
                          <li
                            key={`${item}-${idx}`}
                            className="rw-business-chip rw-chip-include"
                          >
                            <span>{item}</span>
                            <button
                              type="button"
                              aria-label={`Quitar ${item}`}
                              onClick={() => removeTagItem("topics", idx)}
                              disabled={saving}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="rw-business-card">
                    <div className="rw-business-field-head">
                      <label htmlFor="business-excluded">
                        Qué prefieres dejar fuera
                      </label>
                      {excludedItems.length > 0 && (
                        <span className="rw-business-count rw-business-count-muted">
                          {excludedItems.length}
                        </span>
                      )}
                    </div>
                    <textarea
                      id="business-excluded"
                      className="rw-business-autogrow"
                      value={form.excludedTopics}
                      rows={2}
                      placeholder="Ej. tuberías pvc, pintura, obras civiles"
                      onChange={(e) => edit({ excludedTopics: e.target.value })}
                    />
                    <small>
                      Temas o rubros que no quieres recibir en tus alertas.
                    </small>
                    {excludedItems.length > 0 && (
                      <ul
                        className="rw-business-chips"
                        aria-label="Lista de exclusiones"
                      >
                        {excludedItems.map((item, idx) => (
                          <li
                            key={`${item}-${idx}`}
                            className="rw-business-chip rw-chip-exclude"
                          >
                            <span>{item}</span>
                            <button
                              type="button"
                              aria-label={`Quitar exclusión ${item}`}
                              onClick={() =>
                                removeTagItem("excludedTopics", idx)
                              }
                              disabled={saving}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                <details className="rw-business-advanced">
                  <summary>Regiones, presupuesto y entidad</summary>
                  <fieldset className="rw-business-region-fields">
                    <legend>Regiones para las alertas</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.regions.length === 0}
                        onChange={(e) => {
                          if (e.target.checked) edit({ regions: [] });
                        }}
                      />
                      Todas las regiones
                    </label>
                    <div className="rw-business-regions">
                      {latest?.regions.map((region) => (
                        <label key={region}>
                          <input
                            type="checkbox"
                            checked={form.regions.includes(region)}
                            onChange={(e) =>
                              edit({
                                regions: e.target.checked
                                  ? [...form.regions, region]
                                  : form.regions.filter((r) => r !== region),
                              })
                            }
                          />
                          {region}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label htmlFor="business-currency">
                    Moneda del presupuesto
                  </label>
                  <select
                    id="business-currency"
                    value={form.currency}
                    onChange={(e) =>
                      edit({ currency: e.target.value as Form["currency"] })
                    }
                  >
                    <option value="PEN">Soles (S/)</option>
                    <option value="USD">Dólares (US$)</option>
                    <option value="EUR">Euros (€)</option>
                  </select>
                  <div className="rw-business-amounts">
                    <div>
                      <label htmlFor="business-min">Monto mínimo</label>
                      <input
                        id="business-min"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        placeholder="Sin mínimo"
                        value={form.minAmount}
                        onChange={(e) => edit({ minAmount: e.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor="business-max">Monto máximo</label>
                      <input
                        id="business-max"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        placeholder="Sin máximo"
                        value={form.maxAmount}
                        onChange={(e) => edit({ maxAmount: e.target.value })}
                      />
                    </div>
                  </div>
                  <label htmlFor="business-entity">Entidad de interés</label>
                  <input
                    id="business-entity"
                    value={form.entity}
                    placeholder="Cualquier entidad"
                    maxLength={200}
                    onChange={(e) => edit({ entity: e.target.value })}
                  />
                  <small>
                    Las oportunidades sin monto o ubicación publicados siguen
                    incluidas.
                  </small>
                </details>
              </fieldset>
            </>
          )}
        </div>
        {base && (
          <div className="rw-business-actions">
            <span
              className={`rw-business-save-hint${dirty ? " is-dirty" : ""}`}
            >
              {changedElsewhere
                ? "Hay cambios externos pendientes"
                : dirty
                  ? "Cambios pendientes por guardar"
                  : "Ajustes al día"}
            </span>
            <div className="rw-business-action-buttons">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  restore();
                  setEditing(false);
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rw-primary"
                disabled={saving || !dirty || changedElsewhere}
              >
                {saving ? "Guardando…" : "Guardar ajustes"}
              </button>
            </div>
          </div>
        )}
      </form>
    </dialog>
    </div>
  );
}
