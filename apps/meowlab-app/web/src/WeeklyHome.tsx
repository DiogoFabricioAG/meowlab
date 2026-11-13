import { useEffect, useState } from "react";
import { fetchJson, type Me, type Membership } from "./auth-client";
import { Icon } from "./icons";

type Weekly = {
  week: { start: string; end: string };
  team: { members: number; messages: number; activePeople: number; previousMessages: number };
  tender: {
    found: number;
    interesting: number;
    highlights: Array<{ description: string; buyer: string; deadline: string; amount: string; sourceUrl: string | null; interesting: boolean }>;
  };
  invoicing:
    | null
    | { status: "unavailable" }
    | { status: "ok"; documents: number; accepted: number; totalPen: string; previousTotalPen: string; partial: boolean;
        rejected: Array<{ number: string; customer: string; message: string | null }> };
};

const soles = (value: string) =>
  `S/ ${Number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dayMonth = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-PE", { day: "numeric", month: "long", timeZone: "UTC" });

function change(current: number, previous: number): { text: string; tone: "up" | "down" | "flat" } | null {
  if (previous <= 0) return current > 0 ? { text: "Primera semana con actividad", tone: "flat" } : null;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { text: "Igual que la semana pasada", tone: "flat" };
  return { text: `${percent > 0 ? "+" : ""}${percent}% vs. semana pasada`, tone: percent > 0 ? "up" : "down" };
}

function Metric({ label, value, note, tone = "flat" }: { label: string; value: string; note?: string | null; tone?: "up" | "down" | "flat" }) {
  return (
    <div className="rounded-2xl bg-surface-subtle p-5">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-1 font-title text-3xl font-bold tracking-tight text-ink tabular-nums">{value}</div>
      {note && (
        <div className={`mt-1 text-sm ${tone === "up" ? "text-emerald-700" : tone === "down" ? "text-amber-800" : "text-ink-muted"}`}>{note}</div>
      )}
    </div>
  );
}

/** «Inicio»: what the company's agents did this week, from real data only. */
export function WeeklyHome({ me, company, goTo }: { me: Me; company: Membership; goTo: (section: "invoice" | "settings" | "plan") => void }) {
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setWeekly(null);
    setFailed(false);
    void fetchJson<Weekly>(`/api/companies/${encodeURIComponent(company.id)}/weekly`)
      .then((value) => (value ? setWeekly(value) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [company.id]);

  const firstName = me.user.name.trim().split(/\s+/)[0] || "hola";
  const invoicing = weekly?.invoicing && weekly.invoicing.status === "ok" ? weekly.invoicing : null;
  const sales = invoicing ? change(Number(invoicing.totalPen), Number(invoicing.previousTotalPen)) : null;
  const talk = weekly ? change(weekly.team.messages, weekly.team.previousMessages) : null;
  const attention = [
    ...(invoicing?.rejected ?? []).map((doc) => ({
      key: `doc-${doc.number}`,
      icon: "alert" as const,
      tone: "text-amber-700",
      title: `${doc.number} rechazado por SUNAT${doc.customer ? ` · ${doc.customer}` : ""}`,
      text: doc.message ?? "Revisa el comprobante en Invoice Cat.",
      action: { label: "Ver en Invoice Cat", go: () => goTo("invoice") },
    })),
    ...(weekly?.tender.highlights ?? []).filter((tender) => tender.interesting).map((tender) => ({
      key: `tender-${tender.description}-${tender.deadline}`,
      icon: "star" as const,
      tone: "text-forest",
      title: tender.description,
      text: `${tender.buyer} · cierra ${tender.deadline}${tender.amount ? ` · ${tender.amount}` : ""}`,
      action: tender.sourceUrl ? { label: "Ver en SEACE", href: tender.sourceUrl } : null,
    })),
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-sm font-semibold text-ink-muted">
          {weekly ? `Semana del ${dayMonth(weekly.week.start)} al ${dayMonth(weekly.week.end)}` : "Esta semana"}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Hola, {firstName}</h1>
        <p className="text-lg text-ink-muted">Esto es lo que hicieron tus agentes en {company.name}.</p>
      </header>

      {!me.whatsapp.linked && (
        <button type="button" onClick={() => goTo("settings")}
          className="flex w-full items-center justify-between gap-4 rounded-2xl border border-line-mint bg-mint-light px-5 py-4 text-left">
          <span>
            <span className="block font-semibold text-ink">Vincula tu WhatsApp</span>
            <span className="block text-sm text-ink-2">Así tus agentes te reconocen y tu actividad aparece aquí.</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-forest">Ir a Configuración</span>
        </button>
      )}

      {failed && <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">No pudimos cargar la semana. Vuelve a intentarlo en unos minutos.</p>}
      {!weekly && !failed && (
        <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-subtle" />)}
        </div>
      )}

      {weekly && (
        <>
          <section aria-label="Resumen de la semana" className="grid gap-4 sm:grid-cols-3">
            {invoicing ? (
              <Metric label="Facturado (aceptado)" value={soles(invoicing.totalPen)} note={sales?.text} tone={sales?.tone} />
            ) : (
              <Metric label="Facturado" value="—"
                note={weekly.invoicing?.status === "unavailable" ? "FacturaYa no respondió" : "Activa Invoice Cat para verlo"} />
            )}
            <Metric label="Comprobantes emitidos" value={invoicing ? String(invoicing.documents) : "—"}
              note={invoicing ? (invoicing.rejected.length ? `${invoicing.rejected.length} rechazado${invoicing.rejected.length > 1 ? "s" : ""}` : "Ninguno rechazado") : null} />
            <Metric label="Licitaciones encontradas" value={String(weekly.tender.found)}
              note={weekly.tender.interesting ? `${weekly.tender.interesting} marcada${weekly.tender.interesting > 1 ? "s" : ""} como interesante` : null} />
          </section>

          <section className="space-y-3" aria-labelledby="attention-title">
            <h2 id="attention-title" className="text-xl font-bold tracking-tight text-ink">Para atender</h2>
            {attention.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-5 py-4 text-ink-muted">
                Nada pendiente esta semana: sin comprobantes rechazados ni licitaciones marcadas.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
                {attention.map((item) => (
                  <li key={item.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className={`mt-0.5 shrink-0 ${item.tone}`}><Icon name={item.icon} /></span>
                      <div className="min-w-0">
                        <div className="font-semibold text-ink">{item.title}</div>
                        <div className="text-sm text-ink-muted">{item.text}</div>
                      </div>
                    </div>
                    {item.action && ("href" in item.action ? (
                      <a href={item.action.href} target="_blank" rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-forest underline-offset-4 hover:underline">
                        {item.action.label} <Icon name="external" className="h-4 w-4" />
                      </a>
                    ) : (
                      <button type="button" onClick={item.action.go}
                        className="shrink-0 text-left text-sm font-semibold text-forest underline-offset-4 hover:underline">
                        {item.action.label}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-3 rounded-2xl border border-line bg-white p-5" aria-labelledby="team-title">
              <div className="flex items-center gap-2 text-ink">
                <Icon name="message" />
                <h2 id="team-title" className="font-bold">Tu equipo con los agentes</h2>
              </div>
              <p className="font-title text-2xl font-bold text-ink tabular-nums">
                {weekly.team.messages} mensaje{weekly.team.messages === 1 ? "" : "s"}
              </p>
              <p className="text-sm text-ink-muted">
                {weekly.team.activePeople} de {weekly.team.members} persona{weekly.team.members === 1 ? "" : "s"} con WhatsApp en la empresa
                escribieron a sus agentes.{talk ? ` ${talk.text}.` : ""}
              </p>
            </section>
            <section className="space-y-3 rounded-2xl border border-line bg-white p-5" aria-labelledby="tender-title">
              <div className="flex items-center gap-2 text-ink">
                <Icon name="radar" />
                <h2 id="tender-title" className="font-bold">Licitaciones de la semana</h2>
              </div>
              {weekly.tender.highlights.length === 0 ? (
                <p className="text-sm text-ink-muted">Tender Cat no envió licitaciones a tu equipo esta semana.</p>
              ) : (
                <ul className="space-y-2">
                  {weekly.tender.highlights.slice(0, 3).map((tender) => (
                    <li key={`${tender.description}-${tender.deadline}`} className="text-sm">
                      <span className="font-semibold text-ink">{tender.description}</span>
                      <span className="block text-ink-muted">{tender.buyer} · cierra {tender.deadline}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {invoicing?.partial && <p className="text-sm text-ink-muted">La semana tiene muchos comprobantes: el total considera los primeros 200.</p>}
        </>
      )}
    </div>
  );
}
