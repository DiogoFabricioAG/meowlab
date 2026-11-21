import { useState, type FormEvent, type ReactNode } from "react";
import { postJson, type Me, type Membership } from "./auth-client";
import { AGENTS, agentLogo, agentState, type AgentState, type CatalogAgent, type Weekly } from "./agents";
import { PageHeader } from "./PageHeader";
import { TeamPanel } from "./TeamPanel";
import { WhatsAppLink } from "./WhatsAppLink";

type RucResponse = {
  status: "updated" | "invalid_ruc" | "not_found" | "inactive" | "taken" | "forbidden" | "unavailable";
  company?: Membership;
};

const RUC_MESSAGES: Record<string, string> = {
  invalid_ruc: "El RUC debe tener 11 dígitos válidos.",
  not_found: "No encontramos ese RUC en SUNAT. Revisa los dígitos.",
  inactive: "Ese RUC no aparece activo en SUNAT.",
  taken: "Otra empresa ya tiene registrado ese RUC en MeowLab.",
  forbidden: "Solo quien administra la empresa puede agregar el RUC.",
  unavailable: "No pudimos validar el RUC en este momento. Inténtalo en unos minutos.",
};

/** What a cat's state means in Configuración: a short status, never a paragraph. */
export function settingsStatus(state: AgentState): { label: string; tone: "on" | "pending" | "off" } {
  switch (state.kind) {
    case "active":
      return { label: "Activo", tone: "on" };
    case "setup":
      return { label: "Falta configurar", tone: "pending" };
    case "available":
      return { label: "Disponible en Plan", tone: "off" };
    default:
      return { label: "Próximamente", tone: "off" };
  }
}

const TONE: Record<"on" | "pending" | "off", string> = {
  on: "bg-mint-light text-forest",
  pending: "bg-amber-50 text-amber-800",
  off: "bg-surface-subtle text-ink-muted",
};

/** One settings block: title and help on the left, the content on the right (stacked on phones). */
function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line pt-8 first:border-t-0 first:pt-0 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <div className="space-y-1">
        <h2 className="text-lg text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

export function SettingsPage({ me, company, companies, weekly, catalog, openTeam, go, onChange }: {
  me: Me;
  company: Membership | null;
  companies: Membership[];
  weekly: Weekly | null;
  catalog: CatalogAgent[] | null;
  openTeam: boolean;
  go: (path: string) => void;
  onChange: () => void;
}) {
  const [teamOf, setTeamOf] = useState<string | null>(openTeam && company?.role === "owner" ? company.id : null);
  const [addingRucFor, setAddingRucFor] = useState<string | null>(null);
  const [rucInput, setRucInput] = useState("");
  const [rucBusy, setRucBusy] = useState(false);
  const [rucError, setRucError] = useState<string | null>(null);
  const [rucOverrides, setRucOverrides] = useState<Record<string, { ruc: string; legalName: string | null }>>({});
  const initial = (me.user.name || me.user.email).trim().charAt(0).toUpperCase();

  async function saveRuc(event: FormEvent, companyId: string) {
    event.preventDefault();
    setRucError(null);
    setRucBusy(true);
    const result = await postJson<RucResponse>(`/api/companies/${encodeURIComponent(companyId)}/ruc`, { ruc: rucInput }).catch(() => null);
    setRucBusy(false);
    if (result?.status === "updated" && result.company) {
      setRucOverrides((prev) => ({
        ...prev,
        [companyId]: { ruc: result.company!.ruc ?? rucInput, legalName: result.company!.legalName },
      }));
      setAddingRucFor(null);
      setRucInput("");
      onChange();
      return;
    }
    setRucError(RUC_MESSAGES[result?.status ?? "unavailable"] ?? RUC_MESSAGES.unavailable);
  }

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={company?.name} title="Configuración" subtitle="Tu cuenta, tu WhatsApp, tu empresa y tu equipo." />

      <div className="space-y-8">
        <SettingsSection title="Tu cuenta" description="Con estos datos entras al portal.">
          <div className="flex items-center gap-4 rounded-3xl border border-line bg-white p-6 shadow-card">
            {me.user.image ? (
              <img src={me.user.image} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full bg-mint text-lg font-semibold text-forest">{initial}</span>
            )}
            <dl className="min-w-0">
              <dt className="sr-only">Nombre</dt>
              <dd className="truncate font-semibold text-ink">{me.user.name || "Sin nombre"}</dd>
              <dt className="sr-only">Correo</dt>
              <dd className="truncate text-sm text-ink-muted">{me.user.email}</dd>
            </dl>
          </div>
        </SettingsSection>

        <SettingsSection title="WhatsApp" description="El número con el que hablas con tus gatos. Solo ves los datos de las empresas de ese número.">
          <WhatsAppLink whatsapp={me.whatsapp} onChange={onChange} />
        </SettingsSection>

        {companies.length > 0 && (
          <SettingsSection
            title={companies.length === 1 ? "Tu empresa" : "Tus empresas"}
            description="Los datos de la empresa y qué gatos trabajan para ella."
          >
            {companies.map((item) => {
              const current = item.id === company?.id;
              const override = rucOverrides[item.id];
              const currentRuc = override?.ruc ?? item.ruc;
              const currentLegalName = override?.legalName ?? item.legalName;
              const isAddingRuc = addingRucFor === item.id;
              return (
                <article key={item.id} className="overflow-hidden rounded-3xl border border-line bg-white shadow-card">
                  <header className="space-y-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-semibold text-ink">{item.name}</h3>
                        <p className="text-sm text-ink-muted">
                          {currentLegalName && currentLegalName !== item.name ? `${currentLegalName} · ` : ""}
                          {currentRuc ? `RUC ${currentRuc}` : "Sin RUC registrado"}
                        </p>
                      </div>
                      <span className="chip shrink-0 border border-line bg-surface-subtle text-ink-2">
                        {item.role === "owner" ? "Titular" : "Miembro"}
                      </span>
                    </div>

                    {!currentRuc && item.role === "owner" && (
                      <div className="space-y-2.5 rounded-2xl bg-surface-subtle p-4 text-sm">
                        <p className="text-ink-muted">Para emitir comprobantes con Invoice Cat, agrega el RUC de tu empresa.</p>
                        {!isAddingRuc ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAddingRucFor(item.id);
                              setRucInput("");
                              setRucError(null);
                            }}
                            className="btn-secondary min-h-11 bg-white"
                          >
                            Agregar RUC
                          </button>
                        ) : (
                          <form onSubmit={(e) => saveRuc(e, item.id)} className="space-y-2.5">
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                className="field bg-white font-sans tabular-nums tracking-wider sm:max-w-xs"
                                inputMode="numeric"
                                autoComplete="off"
                                aria-label="RUC de la empresa"
                                placeholder="20123456789"
                                value={rucInput}
                                onChange={(e) => setRucInput(e.target.value.replace(/\D/g, "").slice(0, 11))}
                                maxLength={11}
                                required
                              />
                              <div className="flex gap-2">
                                <button type="submit" disabled={rucBusy || rucInput.length !== 11} className="btn-primary min-h-11 shrink-0">
                                  {rucBusy ? "Validando…" : "Guardar RUC"}
                                </button>
                                <button
                                  type="button"
                                  disabled={rucBusy}
                                  onClick={() => {
                                    setAddingRucFor(null);
                                    setRucError(null);
                                  }}
                                  className="btn-secondary min-h-11 bg-white"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                            {rucError && <p role="alert" className="text-xs font-medium text-red-700">{rucError}</p>}
                          </form>
                        )}
                      </div>
                    )}
                  </header>

                  {current ? (
                    <ul className="divide-y divide-line border-t border-line" aria-label={`Gatos de ${item.name}`}>
                      {AGENTS.map((agent) => {
                        const status = settingsStatus(agentState(agent.key, item, weekly, catalog));
                        return (
                          <li key={agent.key}>
                            <a
                              href={agent.detail ?? "/agentes"}
                              onClick={(event) => {
                                event.preventDefault();
                                go(status.tone === "off" ? "/plan" : agent.detail ?? "/agentes");
                              }}
                              className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-subtle"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-mint">
                                <img src={agentLogo(agent.key)} alt="" width={24} height={24} className="h-6 w-6 mix-blend-multiply" decoding="async" />
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{agent.name}</span>
                              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[status.tone]}`}>{status.label}</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="border-t border-line px-5 py-3 text-sm text-ink-muted">Elige esta empresa en el menú para ver sus gatos.</p>
                  )}

                  <footer className="flex flex-wrap gap-2 border-t border-line bg-surface-subtle/60 px-5 py-3">
                    {current && (
                      <button type="button" onClick={() => go("/plan")} className="btn-secondary">Ver plan</button>
                    )}
                    {item.role === "owner" && (
                      <button
                        type="button"
                        onClick={() => setTeamOf(teamOf === item.id ? null : item.id)}
                        aria-expanded={teamOf === item.id}
                        className="btn-secondary"
                      >
                        {teamOf === item.id ? "Cerrar equipo" : "Equipo e invitaciones"}
                      </button>
                    )}
                  </footer>
                  {teamOf === item.id && (
                    <div className="border-t border-line p-5">
                      <TeamPanel key={item.id} company={item} />
                    </div>
                  )}
                </article>
              );
            })}
          </SettingsSection>
        )}
      </div>
    </div>
  );
}
