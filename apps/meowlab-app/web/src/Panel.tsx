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
import type { CatalogAgent, Weekly } from "./agents";
import { Icon, type IconName } from "./icons";

type Section = "home" | "agents" | "invoice" | "tender" | "plan" | "settings" | "team" | "business";

/** Each section has its own address, so Back works and a link can point at it. */
const ROUTES: Record<string, Section> = {
  "/": "home",
  "/inicio": "home",
  "/agentes": "agents",
  "/agentes/facturas": "invoice",
  "/agentes/licitaciones": "tender",
  "/plan": "plan",
  "/ajustes": "settings",
  "/ajustes/equipo": "team",
  "/negocio": "business",
};
const TITLES: Record<Section, string> = {
  home: "Inicio", agents: "Tus agentes", invoice: "Invoice Cat", tender: "Tender Cat", plan: "Plan",
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
 * The signed-in portal: a fixed menu (side on desktop, bottom on phones) with Inicio,
 * Tus agentes, Plan and Configuración. Every agent lives in the same Manolo chat; the
 * portal shows what each one did and what it still needs.
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
    { path: "/agentes", label: "Tus agentes", icon: "grid", matches: ["agents", "invoice", "tender"] },
    { path: "/plan", label: "Plan", icon: "card", matches: ["plan"] },
    { path: "/ajustes", label: "Configuración", icon: "settings", matches: ["settings", "team"] },
  ];
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
    <div className="min-h-dvh bg-white lg:pl-72">
      <a href="#contenido" className="sr-only z-50 rounded-lg bg-forest px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Saltar al contenido
      </a>

      {/* Desktop: fixed side menu. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col bg-forest px-4 py-6 text-mint-text lg:flex" aria-label="Menú">
        <div className="px-3 pb-8"><Logo light /></div>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Secciones">
          {[...nav, ...adminNav].map((item) => {
            const current = item.matches.includes(section);
            return (
              <a key={item.path} href={item.path} aria-current={current ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  go(item.path);
                }}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors focus-visible:outline-mint ${
                  current ? "bg-mint text-forest" : "text-mint-text hover:bg-forest-card hover:text-white"
                }`}>
                <Icon name={item.icon} />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="mt-4 space-y-3 border-t border-forest-card pt-4">
          {company && (
            <div className="space-y-1 rounded-xl bg-forest-card px-3 py-3">
              <span className="block text-xs font-semibold text-mint">Empresa</span>
              {companyPicker("") ?? <span className="block text-sm font-semibold text-white">{company.name}</span>}
            </div>
          )}
          <div className="flex items-center gap-3 px-1">
            <Avatar name={me.user.name} image={me.user.image} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{me.user.name}</div>
              <div className="truncate text-xs text-mint">{me.user.email}</div>
            </div>
            <button type="button" onClick={signOut} disabled={leaving} aria-label="Salir de MeowLab"
              className="grid h-11 w-11 place-items-center rounded-lg text-mint hover:bg-forest-card hover:text-white focus-visible:outline-mint">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      {/* Phones: slim top bar; the menu sits at the bottom, after the content. */}
      <header className="flex h-16 items-center justify-between gap-2 bg-forest px-4 lg:hidden">
        <Logo light />
        <div className="flex items-center gap-1">
          {companyPicker("max-w-[9rem]")}
          <button type="button" onClick={signOut} disabled={leaving} aria-label="Salir de MeowLab"
            className="grid h-11 w-11 place-items-center rounded-lg text-mint focus-visible:outline-mint">
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <main id="contenido" className="mx-auto max-w-5xl px-4 pb-28 pt-8 sm:px-6 lg:px-10 lg:pb-16 lg:pt-12">
        {company && section === "home" && (
          <WeeklyHome me={me} company={company} weekly={weekly} failed={weeklyFailed} catalog={catalog} go={go} />
        )}
        {company && section === "agents" && <AgentsPage company={company} weekly={weekly} catalog={catalog} go={go} />}
        {company && section === "invoice" && <InvoicingPanel company={company} onBack={() => go("/agentes")} />}
        {section === "tender" && <TenderPanel weekly={weekly} onBack={() => go("/agentes")} />}
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
              <Icon name={item.icon} />
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
