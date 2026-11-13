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
  | { status: "created"; company: Membership }
  | { status: "inactive"; taxpayer: Taxpayer }
  | { status: "invalid_ruc" | "not_found" | "taken" | "limit_reached" | "unavailable" };

const MESSAGES: Record<string, string> = {
  invalid_ruc: "Revisa el RUC: son 11 dígitos y el último es de verificación.",
  not_found: "SUNAT no tiene registrado ese RUC.",
  taken: "Esa empresa ya está en MeowLab. Pídele a quien la administra que te envíe una invitación.",
  inactive: "SUNAT no reporta ese RUC como activo, así que no podemos registrarlo.",
  limit_reached: "Ya administras 3 empresas. Escríbenos si necesitas más.",
  rate_limited: "Hiciste muchas consultas seguidas. Espera unos minutos.",
  unavailable: "No pudimos consultar SUNAT en este momento. Inténtalo en unos minutos.",
};

const OPTIONS = [
  { key: "create", title: "Crear mi empresa", text: "Con tu RUC. Quedas como titular y luego invitas a tu equipo." },
  { key: "invite", title: "Tengo una invitación", text: "Quien administra tu empresa te envía un enlace por WhatsApp." },
] as const;

/** «Tu empresa» (ADR-0010): create a company by RUC, join by invitation, or decide later. */
export function CompanyStep({ onDone, onInvitation }: {
  onDone: () => void;
  onInvitation: (code: string) => void;
}) {
  const [link, setLink] = useState("");
  const [mode, setMode] = useState<"choose" | "create" | "invite">("choose");
  const [ruc, setRuc] = useState("");
  const [name, setName] = useState("");
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

  async function create() {
    if (!taxpayer) return;
    setError(null);
    setBusy(true);
    const result = await postJson<CreateResponse>("/api/companies", { ruc: taxpayer.ruc, ...(name.trim() ? { name: name.trim() } : {}) })
      .catch(() => null);
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
          Tus agentes trabajan para una empresa. Créala con tu RUC o únete a la de tu equipo con la invitación de quien la administra.
        </p>
      </div>

      {mode === "choose" && (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMode(option.key)}
              className="group rounded-2xl border border-line bg-white p-5 text-left transition-colors hover:border-forest focus-visible:border-forest"
            >
              <span className="flex items-center justify-between gap-3 text-lg font-bold text-ink group-hover:text-forest">
                {option.title}
                <span aria-hidden="true" className="text-forest transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">→</span>
              </span>
              <span className="mt-1 block text-sm text-ink-muted">{option.text}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "create" && (
        <div className="mt-6 space-y-5">
          <form onSubmit={lookup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 space-y-1.5 sm:max-w-xs">
              <span className="text-sm font-semibold text-ink-2">RUC de la empresa</span>
              <input
                className="field font-title tracking-wider"
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
            <button type="submit" disabled={busy || ruc.length !== 11} className="btn-secondary">
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
                <button type="button" onClick={create} disabled={busy} className="btn-primary">
                  {busy ? "Creando…" : "Crear empresa"}
                </button>
                <span className="text-sm text-ink-muted">Quedarás como titular de esta empresa.</span>
              </div>
            </div>
          )}
        </div>
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
            <button type="submit" disabled={!link.trim()} className="btn-primary">Continuar</button>
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
            className="font-semibold text-forest underline-offset-4 hover:underline"
            onClick={() => {
              setMode("choose");
              setError(null);
            }}
          >
            Volver
          </button>
        </div>
      )}
    </section>
  );
}

/** Companies the account belongs to, with what Invoice Cat still needs. */
export function CompanyCards({ companies, openTeamFor = null }: { companies: Membership[]; openTeamFor?: string | null }) {
  const [teamOf, setTeamOf] = useState<string | null>(openTeamFor);
  const managed = companies.find((company) => company.id === teamOf && company.role === "owner");
  return (
    <section className="space-y-4" aria-labelledby="companies-title">
      <h2 id="companies-title" className="text-xl font-bold tracking-tight text-ink">
        {companies.length === 1 ? "Tu empresa" : "Tus empresas"}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {companies.map((company) => (
          <article key={company.id} className="flex flex-col gap-4 rounded-3xl border border-line bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold text-ink">{company.name}</h3>
                <p className="text-sm text-ink-muted">
                  {company.legalName && company.legalName !== company.name ? `${company.legalName} · ` : ""}RUC {company.ruc ?? "—"}
                </p>
              </div>
              <span className="chip shrink-0 border border-line bg-surface-subtle text-ink-2">
                {company.role === "owner" ? "Titular" : "Miembro"}
              </span>
            </div>
            {company.invoicing === "active" ? (
              <p className="rounded-xl bg-mint-light px-4 py-3 text-sm text-ink-2">Invoice Cat activo con FacturaYa.</p>
            ) : (
              <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
                Invoice Cat todavía no está conectado a SUNAT para esta empresa: falta registrar tu clave SOL (el usuario y clave con
                los que entras a SUNAT Operaciones en Línea). Escríbele a Manolo por WhatsApp y lo conectamos contigo.
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
        ))}
      </div>
      {managed && <TeamPanel key={managed.id} company={managed} />}
    </section>
  );
}
