import { useState, type FormEvent } from "react";
import { fetchJson, postJson, type Membership } from "./auth-client";
import { invitationCodeFrom } from "./InvitationPage";
import { TeamPanel } from "./TeamPanel";

type Taxpayer = { ruc: string; legalName: string; address: string | null; status: string | null; condition: string | null };

type LookupResponse =
  | { status: "ok"; taxpayer: Taxpayer }
  | { status: "inactive"; taxpayer: Taxpayer }
  | { status: "invalid_ruc" | "not_found" | "taken" | "unavailable" | "rate_limited" };

type CreateResponse =
  | { status: "created" | "updated"; company: Membership }
  | { status: "inactive"; taxpayer: Taxpayer }
  | { status: "invalid_ruc" | "invalid_name" | "already_has_ruc" | "not_found" | "taken" | "limit_reached" | "unavailable" };

const MESSAGES: Record<string, string> = {
  invalid_ruc: "Revisa el RUC: son 11 dígitos y el último es de verificación.",
  invalid_name: "Escribe el nombre de tu negocio para continuar.",
  already_has_ruc: "Esta empresa ya tiene un RUC registrado.",
  not_found: "SUNAT no tiene registrado ese RUC.",
  taken: "Esa empresa ya está en MeowLab. Pídele a quien la administra que te envíe una invitación.",
  inactive: "SUNAT no reporta ese RUC como activo, así que no podemos registrarlo.",
  limit_reached: "Ya administras 3 empresas. Escríbenos si necesitas más.",
  rate_limited: "Hiciste muchas consultas seguidas. Espera unos minutos.",
  unavailable: "No pudimos consultar SUNAT en este momento. Inténtalo en unos minutos.",
};

const OPTIONS = [
  {
    key: "create_ruc",
    badge: "Con SUNAT",
    title: "Tengo RUC",
    text: "Buscamos tu razón social en SUNAT y quedas listo para usar todos los gatos, incluido Invoice Cat.",
  },
  {
    key: "create_no_ruc",
    badge: "Rápido",
    title: "Todavía no tengo RUC o prefiero no darlo",
    text: "Empieza solo con el nombre de tu negocio. Podrás agregar tu RUC cuando quieras facturar.",
  },
  {
    key: "invite",
    badge: "Equipo",
    title: "Me invitaron a una empresa",
    text: "Quien administra tu empresa te envía un enlace por WhatsApp para unirte.",
  },
] as const;

type Mode = "choose" | (typeof OPTIONS)[number]["key"];

/** «Tu empresa» (ADR-0010, ADR-0019): create a company with or without RUC, or join by invitation. */
export function CompanyStep({ onDone, onInvitation }: {
  onDone: () => void;
  onInvitation: (code: string) => void;
}) {
  const [link, setLink] = useState("");
  const [mode, setMode] = useState<Mode>("choose");
  const [ruc, setRuc] = useState("");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [taxpayer, setTaxpayer] = useState<Taxpayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setTaxpayer(null);
    setBusy(true);
    const result = await fetchJson<LookupResponse>(`/api/companies/lookup?ruc=${encodeURIComponent(ruc)}`).catch(() => null);
    setBusy(false);
    if (result?.status === "ok") return setTaxpayer(result.taxpayer);
    setError(MESSAGES[result?.status ?? "unavailable"] ?? MESSAGES.unavailable);
  }

  async function createWithRuc() {
    if (!taxpayer) return;
    setError(null);
    setBusy(true);
    const result = await postJson<CreateResponse>("/api/companies", { ruc: taxpayer.ruc, ...(name.trim() ? { name: name.trim() } : {}) })
      .catch(() => null);
    setBusy(false);
    if (result?.status === "created") return onDone();
    setError(MESSAGES[result?.status ?? "unavailable"] ?? MESSAGES.unavailable);
  }

  async function createWithoutRuc(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError(MESSAGES.invalid_name);
      return;
    }
    setError(null);
    setBusy(true);
    const result = await postJson<CreateResponse>("/api/companies", {
      name: cleanName,
      ...(sector.trim() ? { sector: sector.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
    }).catch(() => null);
    setBusy(false);
    if (result?.status === "created") return onDone();
    setError(MESSAGES[result?.status ?? "unavailable"] ?? MESSAGES.unavailable);
  }

  return (
    <section className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8" aria-labelledby="company-title">
      <div className="space-y-2">
        <h2 id="company-title" className="text-2xl font-bold tracking-tight text-ink">
          ¿Con qué empresa vas a usar MeowLab?
        </h2>
        <p className="max-w-[62ch] text-ink-2">
          Tus agentes trabajan para una empresa. Regístrala con RUC, solo con su nombre o únete con la invitación de tu equipo.
        </p>
      </div>

      {mode === "choose" && (
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setError(null);
                setMode(option.key);
              }}
              className="group flex min-h-36 flex-col justify-between rounded-2xl border border-line bg-white p-5 text-left transition-all hover:border-forest hover:bg-mint-light/50 focus-visible:border-forest"
            >
              <div className="space-y-2">
                <span className="chip border border-line-mint bg-mint-light text-forest">{option.badge}</span>
                <span className="flex items-start justify-between gap-3 text-lg font-bold text-ink group-hover:text-forest">
                  <span>{option.title}</span>
                  <span aria-hidden="true" className="shrink-0 text-forest transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">→</span>
                </span>
              </div>
              <span className="mt-3 block text-sm text-ink-muted">{option.text}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "create_ruc" && (
        <div className="mt-6 space-y-5">
          <form onSubmit={lookup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1.5 sm:max-w-xs">
              <span className="text-sm font-semibold text-ink-2">RUC de la empresa</span>
              <input
                className="field font-sans tabular-nums tracking-wider"
                inputMode="numeric"
                autoComplete="off"
                placeholder="20123456789"
                value={ruc}
                onChange={(e) => {
                  setRuc(e.target.value.replace(/\D/g, "").slice(0, 11));
                  setTaxpayer(null);
                }}
                maxLength={11}
                required
              />
            </label>
            <button type="submit" disabled={busy || ruc.length !== 11} className="btn-secondary min-h-12">
              {busy && !taxpayer ? "Consultando…" : "Buscar en SUNAT"}
            </button>
          </form>

          {taxpayer && (
            <div className="space-y-4 rounded-2xl border border-line-mint bg-mint-light p-5">
              <dl className="grid gap-3 sm:grid-cols-[auto_1fr] sm:gap-x-6">
                <dt className="text-sm font-semibold text-ink-muted">Razón social</dt>
                <dd className="font-semibold text-ink">{taxpayer.legalName}</dd>
                {taxpayer.address && (
                  <>
                    <dt className="text-sm font-semibold text-ink-muted">Dirección fiscal</dt>
                    <dd className="text-ink-2">{taxpayer.address}</dd>
                  </>
                )}
                <dt className="text-sm font-semibold text-ink-muted">Estado</dt>
                <dd className="text-ink-2">{[taxpayer.status, taxpayer.condition].filter(Boolean).join(" · ") || "Sin dato"}</dd>
              </dl>
              <label className="block space-y-1.5 sm:max-w-sm">
                <span className="text-sm font-semibold text-ink-2">Nombre comercial (opcional)</span>
                <input
                  className="field bg-white"
                  placeholder={taxpayer.legalName}
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 160))}
                  maxLength={160}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={createWithRuc} disabled={busy} className="btn-primary min-h-12">
                  {busy ? "Creando…" : "Crear empresa"}
                </button>
                <span className="text-sm text-ink-muted">Quedarás como titular de esta empresa.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "create_no_ruc" && (
        <form onSubmit={createWithoutRuc} className="mt-6 space-y-4 rounded-2xl border border-line-mint bg-mint-light/50 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-sm font-semibold text-ink-2">Nombre del negocio</span>
              <input
                className="field bg-white"
                placeholder="Ej. Bodega Rosita o Moda Killa"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 160))}
                maxLength={160}
                required
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink-2">Rubro (opcional)</span>
              <input
                className="field bg-white"
                placeholder="Ej. Ropa, bodega, imprenta"
                value={sector}
                onChange={(e) => setSector(e.target.value.slice(0, 80))}
                maxLength={80}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink-2">Ciudad (opcional)</span>
              <input
                className="field bg-white"
                placeholder="Ej. Lima, Arequipa"
                value={city}
                onChange={(e) => setCity(e.target.value.slice(0, 80))}
                maxLength={80}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !name.trim()} className="btn-primary min-h-12 w-full sm:w-auto">
              {busy ? "Creando…" : "Crear mi empresa"}
            </button>
            <span className="text-sm text-ink-muted">Podrás agregar tu RUC después si activas Invoice Cat.</span>
          </div>
        </form>
      )}

      {mode === "invite" && (
        <form
          className="mt-6 space-y-3 rounded-2xl bg-surface-subtle p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const code = invitationCodeFrom(link);
            if (code) return onInvitation(code);
            setError("Ese enlace no parece una invitación de MeowLab. Cópialo completo desde el mensaje que te enviaron.");
          }}
        >
          <p className="text-ink-2">
            Quien administra tu empresa te envía un enlace por WhatsApp desde su panel. Ábrelo, o pégalo aquí:
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1.5">
              <span className="text-sm font-semibold text-ink-2">Enlace de invitación</span>
              <input className="field bg-white" placeholder="https://app.meowlab.tech/invitacion/…" value={link}
                onChange={(e) => setLink(e.target.value)} maxLength={300} required />
            </label>
            <button type="submit" disabled={!link.trim()} className="btn-primary min-h-12">Continuar</button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {mode !== "choose" && (
        <div className="mt-6 border-t border-line pt-5 text-sm">
          <button
            type="button"
            className="inline-flex min-h-11 items-center font-semibold text-forest underline-offset-4 hover:underline"
            onClick={() => {
              setMode("choose");
              setError(null);
            }}
          >
            ← Volver a las opciones
          </button>
        </div>
      )}
    </section>
  );
}

/** Companies the account belongs to, with what Invoice Cat still needs. */
export function CompanyCards({ companies, openTeamFor = null }: { companies: Membership[]; openTeamFor?: string | null }) {
  const [teamOf, setTeamOf] = useState<string | null>(openTeamFor);
  const [addingRucFor, setAddingRucFor] = useState<string | null>(null);
  const [rucInput, setRucInput] = useState("");
  const [rucBusy, setRucBusy] = useState(false);
  const [rucError, setRucError] = useState<string | null>(null);
  const [rucOverrides, setRucOverrides] = useState<Record<string, { ruc: string; legalName: string | null }>>({});
  const managed = companies.find((company) => company.id === teamOf && company.role === "owner");

  async function saveRuc(event: FormEvent, companyId: string) {
    event.preventDefault();
    setRucError(null);
    setRucBusy(true);
    const result = await postJson<CreateResponse>(`/api/companies/${encodeURIComponent(companyId)}/ruc`, { ruc: rucInput }).catch(() => null);
    setRucBusy(false);
    if (result?.status === "updated") {
      setRucOverrides((prev) => ({ ...prev, [companyId]: { ruc: result.company.ruc ?? rucInput, legalName: result.company.legalName } }));
      setAddingRucFor(null);
      setRucInput("");
      return;
    }
    setRucError(MESSAGES[result?.status ?? "unavailable"] ?? MESSAGES.unavailable);
  }

  return (
    <section className="space-y-4" aria-labelledby="companies-title">
      <h2 id="companies-title" className="text-xl font-bold tracking-tight text-ink">
        {companies.length === 1 ? "Tu empresa" : "Tus empresas"}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((company) => {
          const override = rucOverrides[company.id];
          const currentRuc = override?.ruc ?? company.ruc;
          const currentLegalName = override?.legalName ?? company.legalName;
          const isAdding = addingRucFor === company.id;
          return (
            <article key={company.id} className="flex flex-col gap-4 rounded-3xl border border-line bg-white p-6 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-bold text-ink">{company.name}</h3>
                  <p className="text-sm text-ink-muted">
                    {currentLegalName && currentLegalName !== company.name ? `${currentLegalName} · ` : ""}
                    {currentRuc ? `RUC ${currentRuc}` : "Sin RUC"}
                  </p>
                </div>
                <span className="chip shrink-0 border border-line bg-surface-subtle text-ink-2">
                  {company.role === "owner" ? "Titular" : "Miembro"}
                </span>
              </div>
              {company.invoicing === "active" ? (
                <p className="rounded-xl bg-mint-light px-4 py-3 text-sm text-ink-2">Invoice Cat activo.</p>
              ) : !currentRuc ? (
                <div className="space-y-3 rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                  <p>Para emitir comprobantes, agrega el RUC de tu empresa.</p>
                  {company.role === "owner" && !isAdding && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingRucFor(company.id);
                        setRucInput("");
                        setRucError(null);
                      }}
                      className="btn-secondary min-h-11 bg-white"
                    >
                      Agregar RUC
                    </button>
                  )}
                  {company.role === "owner" && isAdding && (
                    <form onSubmit={(e) => saveRuc(e, company.id)} className="space-y-3 pt-1">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          className="field bg-white font-sans tabular-nums tracking-wider"
                          inputMode="numeric"
                          placeholder="20123456789"
                          value={rucInput}
                          onChange={(e) => setRucInput(e.target.value.replace(/\D/g, "").slice(0, 11))}
                          maxLength={11}
                          required
                        />
                        <button type="submit" disabled={rucBusy || rucInput.length !== 11} className="btn-primary min-h-11 shrink-0">
                          {rucBusy ? "Validando…" : "Guardar RUC"}
                        </button>
                      </div>
                      {rucError && <p role="alert" className="text-xs text-red-700">{rucError}</p>}
                    </form>
                  )}
                </div>
              ) : (
                <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                  Invoice Cat todavía no está conectado a SUNAT para esta empresa: falta registrar tu clave SOL (el usuario y clave con
                  los que entras a SUNAT Operaciones en Línea). Escríbele a MeowLab por WhatsApp y lo conectamos contigo.
                </p>
              )}
              {company.role === "owner" && (
                <button
                  type="button"
                  onClick={() => setTeamOf(teamOf === company.id ? null : company.id)}
                  aria-expanded={teamOf === company.id}
                  className="btn-secondary w-fit"
                >
                  {teamOf === company.id ? "Cerrar equipo" : "Equipo e invitaciones"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {managed && <TeamPanel key={managed.id} company={managed} />}
    </section>
  );
}
