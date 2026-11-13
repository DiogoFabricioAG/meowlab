import { useState } from "react";
import { authClient, type Me } from "./auth-client";
import { Logo } from "./App";
import { WhatsAppLink } from "./WhatsAppLink";
import { AdminPanel } from "./AdminPanel";
import { PlanPanel } from "./PlanPanel";
import { InvoicingPanel } from "./InvoicingPanel";
import { CompanyCards } from "./CompanyStep";
import { WeeklyHome } from "./WeeklyHome";
import { Icon, type IconName } from "./icons";

type Section = "home" | "invoice" | "plan" | "settings" | "business";

// The company the person is looking at, remembered per browser.
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

type NavItem = { key: Section; label: string; short: string; icon: IconName };

/**
 * The signed-in portal: a fixed menu (side on desktop, bottom on phones) with Inicio,
 * one entry per agent the company has, Plan and Configuración. Agents appear as the
 * company activates them.
 */
export function Panel({ me, onChange }: { me: Me; onChange: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const companies = me.companies ?? [];
  const [companyId, setCompanyId] = useState(() => {
    const saved = readCompany();
    return companies.find((company) => company.id === saved)?.id ?? companies[0]?.id ?? null;
  });
  const company = companies.find((item) => item.id === companyId) ?? companies[0] ?? null;
  const invoicingAvailable = me.modules.some((module) => module.key === "billing" && module.status === "available");
  const [section, setSection] = useState<Section>(
    new URLSearchParams(window.location.search).get("pago") === "retorno" ? "plan" : "home",
  );

  const agents: NavItem[] = invoicingAvailable ? [{ key: "invoice", label: "Invoice Cat", short: "Facturas", icon: "invoice" }] : [];
  const account: NavItem[] = [
    { key: "plan", label: "Plan", short: "Plan", icon: "card" },
    { key: "settings", label: "Configuración", short: "Ajustes", icon: "settings" },
    ...(me.isAdmin ? [{ key: "business" as const, label: "Negocio", short: "Negocio", icon: "chart" as const }] : []),
  ];
  const home: NavItem = { key: "home", label: "Inicio", short: "Inicio", icon: "home" };
  const go = (next: Section) => {
    setSection(next);
    window.scrollTo({ top: 0 });
  };
  const current = section === "invoice" && !invoicingAvailable ? "home" : section;

  async function signOut() {
    setLeaving(true);
    await authClient.signOut();
  }

  const navButton = (item: NavItem) => (
    <button
      key={item.key}
      type="button"
      onClick={() => go(item.key)}
      aria-current={current === item.key ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold transition-colors ${
        current === item.key ? "bg-mint-light text-forest" : "text-ink-2 hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      <Icon name={item.icon} />
      {item.label}
    </button>
  );

  return (
    <div className="min-h-dvh bg-white lg:pl-72">
      {/* Desktop: fixed side menu. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col border-r border-line bg-white px-4 py-6 lg:flex" aria-label="Menú">
        <div className="px-3 pb-6"><Logo /></div>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Secciones">
          {navButton(home)}
          <div className="px-3 pb-1 pt-5 text-xs font-semibold text-ink-muted">Tus agentes</div>
          {agents.map(navButton)}
          <button type="button" onClick={() => go("plan")}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold text-ink-muted hover:bg-surface-subtle hover:text-ink">
            <Icon name="plus" />
            Sumar agente
          </button>
          <div className="flex-1" />
          {account.map(navButton)}
        </nav>
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {companies.length > 1 && company ? (
            <label className="block space-y-1 px-1">
              <span className="text-xs font-semibold text-ink-muted">Empresa</span>
              <select className="field py-2 text-sm" value={company.id}
                onChange={(event) => {
                  setCompanyId(event.target.value);
                  writeCompany(event.target.value);
                }}>
                {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          ) : company ? (
            <div className="px-1 text-sm"><span className="block text-xs font-semibold text-ink-muted">Empresa</span>
              <span className="font-semibold text-ink">{company.name}</span></div>
          ) : null}
          <div className="flex items-center gap-3 px-1">
            <Avatar name={me.user.name} image={me.user.image} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{me.user.name}</div>
              <div className="truncate text-xs text-ink-muted">{me.user.email}</div>
            </div>
            <button type="button" onClick={signOut} disabled={leaving} aria-label="Salir"
              className="rounded-lg p-2 text-ink-muted hover:bg-surface-subtle hover:text-ink">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      {/* Phones: slim top bar plus a fixed bottom menu. */}
      <header className="flex h-16 items-center justify-between border-b border-line px-4 lg:hidden">
        <Logo />
        <div className="flex items-center gap-2">
          {companies.length > 1 && company && (
            <select className="field max-w-[9rem] py-1.5 text-sm" value={company.id} aria-label="Empresa"
              onChange={(event) => {
                setCompanyId(event.target.value);
                writeCompany(event.target.value);
              }}>
              {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          <button type="button" onClick={signOut} disabled={leaving} aria-label="Salir" className="rounded-lg p-2 text-ink-muted">
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        style={{ gridTemplateColumns: `repeat(${1 + agents.length + 2}, minmax(0, 1fr))` }} aria-label="Secciones">
        {[home, ...agents, account[0], account[1]].map((item) => (
          <button key={item.key} type="button" onClick={() => go(item.key)} aria-current={current === item.key ? "page" : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${current === item.key ? "text-forest" : "text-ink-muted"}`}>
            <Icon name={item.icon} />
            {item.short}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-8 sm:px-6 lg:px-10 lg:pb-16 lg:pt-12">
        {current === "home" && company && <WeeklyHome me={me} company={company} goTo={go} />}
        {current === "invoice" && <InvoicingPanel />}
        {current === "plan" && <PlanPanel email={me.user.email} />}
        {current === "business" && me.isAdmin && <AdminPanel />}
        {current === "settings" && (
          <div className="space-y-10">
            <header className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight text-ink">Configuración</h1>
              <p className="text-lg text-ink-muted">Tu WhatsApp, tu empresa y tu equipo.</p>
            </header>
            <section className="space-y-4" aria-labelledby="whatsapp-title">
              <h2 id="whatsapp-title" className="text-xl font-bold tracking-tight text-ink">WhatsApp</h2>
              <WhatsAppLink whatsapp={me.whatsapp} onChange={onChange} />
            </section>
            {companies.length > 0 && <CompanyCards companies={companies} />}
          </div>
        )}
      </main>
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
