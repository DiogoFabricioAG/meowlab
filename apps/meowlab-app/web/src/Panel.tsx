import { useCallback, useEffect, useRef, useState } from "react";
import { authClient, fetchJson, type Me } from "./auth-client";
import { Logo } from "./App";
import { WhatsAppLink } from "./WhatsAppLink";
import { AdminPanel } from "./AdminPanel";
import { PlanPanel } from "./PlanPanel";
import { InvoicingPanel } from "./InvoicingPanel";
import { CompanyCards } from "./CompanyStep";
import { WeeklyHome } from "./WeeklyHome";
import { AgentsPage, TenderPanel } from "./AgentsPage";
import { StockPanel } from "./StockPanel";
import { CollectionsPanel } from "./CollectionsPanel";
import { ReorderPanel } from "./ReorderPanel";
import { SupportPanel } from "./SupportPanel";
import { AGENTS, agentLogo, agentState, type CatalogAgent, type Weekly } from "./agents";
import { agentPulse, attentionItems, PULSE_LABEL } from "./attention";
import { Icon, type IconName } from "./icons";

type Section = "home" | "agents" | "invoice" | "tender" | "stock" | "collections" | "reorder" | "support" | "plan" | "settings" | "team" | "business";

/** Each section has its own address, so Back works and a link can point at it. */
const ROUTES: Record<string, Section> = {
  "/": "home",
  "/inicio": "home",
  "/agentes": "agents",
  "/agentes/facturas": "invoice",
  "/agentes/licitaciones": "tender",
  "/agentes/stock": "stock",
  "/agentes/cobranza": "collections",
  "/agentes/reposicion": "reorder",
  "/agentes/soporte": "support",
  "/plan": "plan",
  "/ajustes": "settings",
  "/ajustes/equipo": "team",
  "/negocio": "business",
};
const TITLES: Record<Section, string> = {
  home: "Inicio", agents: "Tus agentes", invoice: "Invoice Cat", tender: "Tender Cat", stock: "Stock Cat", collections: "Collections Cat", reorder: "Reorder Cat", support: "Support Cat", plan: "Plan",
  settings: "Configuración", team: "Equipo", business: "Negocio",
};
const sectionOf = (path: string): Section => ROUTES[path.replace(/\/+$/, "") || "/"] ?? "home";

// The company being looked at, remembered per browser.
const COMPANY_KEY = "meowlab.company";
const readCompany = () => {
  try {
    return window.localStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
};
const writeCompany = (id: string) => {
  try {
    window.localStorage.setItem(COMPANY_KEY, id);
  } catch {
    // Storage blocked: the first company is shown next time.
  }
};

type NavItem = { path: string; label: string; icon: IconName; matches: Section[] };

/**
 * The signed-in portal: a light fixed menu (side on desktop, bottom on phones) with Inicio,
 * Tus agentes, Plan and Configuración, and the business's cats with how each is doing. The
 * forest green is kept for what matters: the current page, the actions and the states.
 */
export function Panel({ me, onChange }: { me: Me; onChange: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const companies = me.companies ?? [];
  const [companyId, setCompanyId] = useState(() => {
    const saved = readCompany();
    return companies.find((company) => company.id === saved)?.id ?? companies[0]?.id ?? null;
  });
  const company = companies.find((item) => item.id === companyId) ?? companies[0] ?? null;
  const [section, setSection] = useState<Section>(() =>
    new URLSearchParams(window.location.search).get("pago") === "retorno" ? "plan" : sectionOf(window.location.pathname));
  const navigated = useRef(false);

  // Data shared by Inicio and Tus agentes, loaded once per company.
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [weeklyFailed, setWeeklyFailed] = useState(false);
  const [catalog, setCatalog] = useState<CatalogAgent[] | null>(null);
  useEffect(() => {
    if (!company) return;
    setWeekly(null);
    setWeeklyFailed(false);
    void fetchJson<Weekly>(`/api/companies/${encodeURIComponent(company.id)}/weekly`)
      .then((value) => (value ? setWeekly(value) : setWeeklyFailed(true)))
      .catch(() => setWeeklyFailed(true));
  }, [company?.id]);
  useEffect(() => {
    void fetchJson<{ agents: CatalogAgent[] }>("/api/billing").then((value) => setCatalog(value?.agents ?? null)).catch(() => setCatalog(null));
  }, []);

  useEffect(() => {
    const onPop = () => setSection(sectionOf(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = `${TITLES[section]} · MeowLab`;
    // After a navigation (not the first load), move focus to the new page's heading.
    if (!navigated.current) return;
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }, [section]);

  const go = useCallback((path: string) => {
    navigated.current = true;
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setSection(sectionOf(path));
    window.scrollTo({ top: 0 });
  }, []);

  const nav: NavItem[] = [
    { path: "/inicio", label: "Inicio", icon: "home", matches: ["home"] },
    { path: "/agentes", label: "Tus agentes", icon: "grid", matches: ["agents", "invoice", "tender", "stock", "collections", "reorder", "support"] },
    { path: "/plan", label: "Plan", icon: "card", matches: ["plan"] },
    { path: "/ajustes", label: "Configuración", icon: "settings", matches: ["settings", "team"] },
  ];
  const pending = attentionItems(weekly).length;
  const cats = company
    ? AGENTS.filter((agent) => agentState(agent.key, company, weekly, catalog).kind === "active")
      .map((agent) => ({ agent, pulse: agentPulse(agent.key, weekly) }))
    : [];
  const adminNav: NavItem[] = me.isAdmin ? [{ path: "/negocio", label: "Negocio", icon: "chart", matches: ["business"] }] : [];

  async function signOut() {
    setLeaving(true);
    await authClient.signOut();
  }

  const chooseCompany = (id: string) => {
    setCompanyId(id);
    writeCompany(id);
  };

  const companyPicker = (className: string) =>
    companies.length > 1 && company ? (
      <select className={`field py-2 text-sm ${className}`} value={company.id} aria-label="Empresa" onChange={(event) => chooseCompany(event.target.value)}>
        {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    ) : null;

  return (
    <div className="min-h-dvh bg-white lg:pl-64">
      <a href="#contenido" className="sr-only z-50 rounded-lg bg-forest px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Saltar al contenido
      </a>

      {/* Desktop: fixed side menu, light, with the cats and how each is doing. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col overflow-y-auto border-r border-line bg-white px-3 py-5 lg:flex" aria-label="Menú">
        <div className="px-3 pb-5"><Logo /></div>
        {company && (
          <div className="mx-1 mb-4 space-y-0.5 rounded-xl border border-line px-3 py-2.5">
            <span className="block text-xs font-semibold text-ink-muted">Empresa</span>
            {companyPicker("") ?? <span className="block truncate text-sm font-semibold text-ink">{company.name}</span>}
          </div>
        )}
        <nav className="flex flex-col gap-0.5" aria-label="Secciones">
          {[...nav, ...adminNav].map((item) => {
            const current = item.matches.includes(section);
            const count = item.path === "/inicio" ? pending : 0;
            return (
              <a key={item.path} href={item.path} aria-current={current ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  go(item.path);
                }}
                className={`flex items-center gap-3 rounded-[10px] px-3 py-2 text-[15px] font-semibold transition-colors ${
                  current ? "bg-mint-subtle text-forest" : "text-ink-2 hover:bg-surface-subtle hover:text-ink"
                }`}>
                <Icon name={item.icon} />
                {item.label}
                {count > 0 && (
                  <span className="ml-auto rounded-full bg-forest px-2 text-xs font-semibold leading-5 text-white tabular-nums">
                    {count}<span className="sr-only"> pendientes</span>
                  </span>
                )}
              </a>
            );
          })}
        </nav>
        {cats.length > 0 && (
          <div className="mt-5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Tus gatos</p>
            <ul className="flex flex-col gap-0.5">
              {cats.map(({ agent, pulse }) => (
                <li key={agent.key}>
                  <a href={agent.detail ?? "/agentes"} title={PULSE_LABEL[pulse]}
                    onClick={(event) => {
                      event.preventDefault();
                      go(agent.detail ?? "/agentes");
                    }}
                    className="flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-surface-subtle hover:text-ink">
                    <img src={agentLogo(agent.key)} alt="" width={20} height={20} className="h-5 w-5 mix-blend-multiply" decoding="async" />
                    <span className="truncate">{agent.name}</span>
                    <span aria-hidden="true" className={`ml-auto h-2 w-2 shrink-0 rounded-full ${pulse === "needs" ? "bg-amber-500" : pulse === "working" ? "bg-forest" : "bg-line-mint"}`} />
                    <span className="sr-only">{PULSE_LABEL[pulse]}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-auto flex items-center gap-3 border-t border-line px-2 pt-4">
          <Avatar name={me.user.name} image={me.user.image} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{me.user.name}</div>
            <div className="truncate text-xs text-ink-muted">{me.user.email}</div>
          </div>
          <button type="button" onClick={signOut} disabled={leaving} aria-label="Salir de MeowLab"
            className="grid h-10 w-10 place-items-center rounded-lg text-ink-muted hover:bg-surface-subtle hover:text-ink">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      {/* Phones: slim top bar; the menu sits at the bottom, after the content. */}
      <header className="flex h-16 items-center justify-between gap-2 border-b border-line bg-white px-4 lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          {companyPicker("max-w-[9rem]")}
          <button type="button" onClick={signOut} disabled={leaving} aria-label="Salir de MeowLab"
            className="grid h-11 w-11 place-items-center rounded-lg text-ink-muted">
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <main id="contenido" className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
        {company && section === "home" && (
          <WeeklyHome me={me} company={company} weekly={weekly} failed={weeklyFailed} catalog={catalog} go={go} />
        )}
        {company && section === "agents" && <AgentsPage company={company} weekly={weekly} catalog={catalog} go={go} />}
        {company && section === "invoice" && <InvoicingPanel company={company} onBack={() => go("/agentes")} />}
        {section === "tender" && <TenderPanel weekly={weekly} onBack={() => go("/agentes")} />}
        {company && section === "stock" && <StockPanel key={company.id} company={company} onBack={() => go("/agentes")} />}
        {company && section === "collections" && <CollectionsPanel key={company.id} company={company} onBack={() => go("/agentes")} />}
        {company && section === "reorder" && <ReorderPanel key={company.id} company={company} onBack={() => go("/agentes")} />}
        {company && section === "support" && <SupportPanel key={company.id} company={company} onBack={() => go("/agentes")} />}
        {company && section === "plan" && <PlanPanel key={company.id} email={me.user.email} company={company} />}
        {section === "business" && (me.isAdmin ? <AdminPanel /> : <p className="text-ink-muted">Esta sección es solo para el equipo de MeowLab.</p>)}
        {(section === "settings" || section === "team") && (
          <div className="space-y-10">
            <header className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight text-ink">Configuración</h1>
              <p className="text-lg text-ink-muted">Tu WhatsApp, tu empresa y tu equipo.</p>
            </header>
            <section className="space-y-4" aria-label="WhatsApp">
              <WhatsAppLink whatsapp={me.whatsapp} onChange={onChange} />
            </section>
            {companies.length > 0 && (
              <CompanyCards key={section} companies={companies} openTeamFor={section === "team" && company?.role === "owner" ? company.id : null} />
            )}
          </div>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="Secciones">
        {nav.map((item) => {
          const current = item.matches.includes(section);
          return (
            <a key={item.path} href={item.path} aria-current={current ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                go(item.path);
              }}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${current ? "text-forest" : "text-ink-muted"}`}>
              {current && <span aria-hidden="true" className="absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-forest" />}
              <span className="relative">
                <Icon name={item.icon} />
                {item.path === "/inicio" && pending > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-forest px-1 text-center text-[10px] leading-4 text-white tabular-nums">
                    {pending}<span className="sr-only"> pendientes</span>
                  </span>
                )}
              </span>
              {item.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return <img src={image} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mint font-title text-sm font-bold text-forest">
      {initials || "M"}
    </span>
  );
}
