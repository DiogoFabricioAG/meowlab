import { useEffect, useState } from "react";
import type { Membership } from "./auth-client";
import { PageHeader } from "./PageHeader";
import { apiFetch } from "./api";

type Ticket = {
  id: string; number: number; kind: "question" | "complaint" | "human" | "sale" | "unhappy"; priority: "normal" | "high";
  status: "open" | "answered" | "closed"; customerName: string | null; customerPhone: string; question: string; answer: string | null;
  relayed: boolean; createdAt: string;
};
type Faq = { id: string; question: string; answer: string };
type SupportView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    phoneNumberId: string | null;
    faqs: Faq[];
    open: Ticket[];
    recent: Ticket[];
    today: { customers: number; answered: number; quoted: number; escalated: number; ratedYes: number; ratedNo: number; open: number };
  };

const KIND: Record<Ticket["kind"], string> = {
  question: "Pregunta", complaint: "Reclamo", human: "Pidió una persona", sale: "Quiere comprar", unhappy: "No quedó conforme",
};
const shownPhone = (phone: string) => phone.replace(/^51(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
const when = (iso: string) => new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const FIELD = "mt-1 block w-full rounded-[10px] border border-line bg-white px-3 py-2 text-ink focus:border-forest focus:outline-none disabled:bg-surface-subtle";

function TicketCard({ ticket }: { ticket: Ticket }) {
  return (
    <li className={`rounded-2xl border bg-white px-4 py-3 text-sm ${ticket.priority === "high" && ticket.status === "open" ? "border-amber-200 bg-amber-50/60" : "border-line"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold text-ink">
          {ticket.customerName ?? shownPhone(ticket.customerPhone)}
          <span className="ml-2 font-normal text-ink-muted">#{ticket.number} · {when(ticket.createdAt)}</span>
        </p>
        <span className="chip border border-line bg-surface-subtle text-ink-2">{KIND[ticket.kind]}</span>
      </div>
      <p className="mt-2 text-ink-2">«{ticket.question}»</p>
      {ticket.answer && (
        <p className="mt-2 text-ink-muted">
          Respuesta: «{ticket.answer}» {ticket.relayed ? "· enviada al cliente" : "· no se pudo enviar por WhatsApp"}
        </p>
      )}
      <a href={`https://wa.me/${ticket.customerPhone}`} target="_blank" rel="noreferrer"
        className="mt-2 inline-block font-semibold text-forest underline underline-offset-4">Escribirle ({shownPhone(ticket.customerPhone)})</a>
    </li>
  );
}

/**
 * Support Cat's page (ADR-0017): today's numbers, the pending cases, the frequent questions the
 * cat answers with (only the owner edits them) and what was already handled. Cases are answered
 * in the chat with /support, where the message to the customer goes out.
 */
export function SupportPanel({ company, onBack }: { company: Membership; onBack: () => void }) {
  const [view, setView] = useState<SupportView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [tab, setTab] = useState<"cases" | "faqs">("cases");

  useEffect(() => {
    setState("loading");
    void apiFetch(`/api/companies/${encodeURIComponent(company.id)}/support`)
      .then(async (response) => {
        if (!response.ok) return setState("error");
        setView(await response.json() as SupportView);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [company.id]);

  return (
    <div className="space-y-6">
      <PageHeader
        onBack={onBack}
        agent="support"
        title="Support Cat"
        subtitle={
          state === "loading" ? "Revisando tus casos…"
            : state === "error" ? "No pudimos cargar Support Cat. Inténtalo otra vez en unos minutos."
            : !view?.enabled ? "Support Cat no está activo para esta empresa."
            : view.open.length ? `${view.open.length} ${view.open.length === 1 ? "caso necesita" : "casos necesitan"} tu respuesta.`
            : "Todo atendido."
        }
      />

      {view?.enabled && (
        <>
          <div className="rounded-2xl bg-forest px-5 py-4 text-white">
            <span className="block text-sm text-mint-text">Hoy</span>
            <span className="text-2xl font-bold tabular-nums">{view.today.customers} {view.today.customers === 1 ? "cliente" : "clientes"}</span>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              {([["Resueltos solo", view.today.answered], ["Cotizaciones", view.today.quoted], ["Te pasó", view.today.escalated],
                ["«¿Te ayudé?» sí / no", `${view.today.ratedYes} / ${view.today.ratedNo}`]] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-white/10 px-3 py-2">
                  <dt className="text-mint-text">{label}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {!view.phoneNumberId && (
            <p role="status" className="rounded-2xl bg-surface-subtle px-5 py-4 text-sm text-ink-2">
              Tu empresa todavía no tiene un número de WhatsApp conectado a Support Cat. Escríbele al equipo de MeowLab para conectarlo.
            </p>
          )}

          <div className="grid w-full grid-cols-2 gap-1 rounded-[12px] bg-surface-subtle p-1 sm:w-fit" role="tablist" aria-label="Vistas de Support Cat">
            {(["cases", "faqs"] as const).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`min-h-11 rounded-[10px] px-4 text-sm font-semibold transition-colors ${tab === key ? "bg-white text-forest shadow-soft" : "text-ink-muted hover:text-ink"}`}>
                {key === "cases" ? "Casos" : "Preguntas frecuentes"}
              </button>
            ))}
          </div>

          {tab === "cases" && (
            <div className="space-y-5">
              {view.open.length > 0 ? (
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-ink">Pendientes</h2>
                  <ul className="space-y-2">{view.open.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}</ul>
                  <p className="text-sm text-ink-muted">Respóndelos en el chat con /support: lo que escribas se lo paso al cliente.</p>
                </section>
              ) : (
                <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
                  No hay casos pendientes. Cuando un cliente pregunte algo que Support Cat no sabe, reclame o pida una persona, aparece aquí.
                </p>
              )}
              {view.recent.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-ink">Atendidos</h2>
                  <ul className="space-y-2">{view.recent.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}</ul>
                </section>
              )}
            </div>
          )}

          {tab === "faqs" && <Faqs company={company} owner={view.owner} faqs={view.faqs} onSaved={setView} />}

          <p className="text-sm text-ink-muted">
            Support Cat atiende a tus clientes las 24 horas en el WhatsApp de tu empresa: responde con estas preguntas frecuentes y el estado
            de sus cotizaciones y compras, cotiza con tu catálogo de Sales Cat y te pasa lo demás. Cada noche te manda un resumen.
          </p>
        </>
      )}
    </div>
  );
}

function Faqs({ company, owner, faqs, onSaved }: { company: Membership; owner: boolean; faqs: Faq[]; onSaved: (view: SupportView) => void }) {
  const [draft, setDraft] = useState<{ id?: string; question: string; answer: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function send(faq: Record<string, unknown>) {
    setStatus("saving");
    const response = await apiFetch(`/api/companies/${encodeURIComponent(company.id)}/support/faq`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ faq }),
    }).catch(() => null);
    if (!response?.ok) return setStatus("error");
    onSaved(await response.json() as SupportView);
    setDraft(null);
    setStatus("idle");
  }

  return (
    <div className="space-y-4">
      {!owner && <p className="text-sm text-ink-muted">Solo la titular de la empresa puede cambiar las preguntas frecuentes.</p>}
      {faqs.length === 0 && !draft && (
        <p className="rounded-2xl bg-surface-subtle px-5 py-4 text-ink-muted">
          Todavía no hay preguntas. Agrega lo que tus clientes preguntan siempre: horario, dirección, delivery, formas de pago, cambios y devoluciones.
        </p>
      )}
      <ul className="space-y-2">
        {faqs.map((faq) => (
          <li key={faq.id} className="rounded-2xl border border-line bg-white px-4 py-3 text-sm">
            <p className="font-semibold text-ink">{faq.question}</p>
            <p className="mt-1 whitespace-pre-line text-ink-2">{faq.answer}</p>
            {owner && (
              <div className="mt-2 flex gap-4">
                <button type="button" onClick={() => setDraft({ id: faq.id, question: faq.question, answer: faq.answer })}
                  className="min-h-11 font-semibold text-forest underline-offset-4 hover:underline">Editar</button>
                <button type="button" onClick={() => void send({ id: faq.id, remove: true })}
                  className="min-h-11 font-semibold text-red-700 underline-offset-4 hover:underline">Quitar</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {owner && (draft ? (
        <form onSubmit={(event) => { event.preventDefault(); void send({ ...(draft.id ? { id: draft.id } : {}), question: draft.question, answer: draft.answer }); }}
          className="space-y-3 rounded-2xl border border-line bg-white px-5 py-5">
          <label className="block text-sm font-medium text-ink-2">Pregunta
            <input required maxLength={300} value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })}
              placeholder="¿Hacen delivery?" className={`${FIELD} min-h-11`} />
          </label>
          <label className="block text-sm font-medium text-ink-2">Respuesta
            <textarea required maxLength={1500} rows={3} value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
              placeholder="Sí, en Lima Metropolitana por S/ 10. Llega en 24 a 48 horas." className={FIELD} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={status === "saving"}
              className="min-h-11 rounded-[10px] bg-forest px-5 text-sm font-semibold text-white hover:bg-forest/90 disabled:opacity-60">
              {status === "saving" ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-11 px-3 text-sm font-semibold text-ink-muted hover:text-ink">Cancelar</button>
            {status === "error" && <p role="status" className="text-sm text-red-700">No pudimos guardar. Inténtalo otra vez.</p>}
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setDraft({ question: "", answer: "" })}
          className="min-h-11 rounded-[10px] border border-forest px-5 text-sm font-semibold text-forest hover:bg-mint">
          Agregar pregunta
        </button>
      ))}
    </div>
  );
}
