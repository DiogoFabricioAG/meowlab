import { AGENTS, agentLogo, type AgentKey } from "./agents";
import { PageHeader } from "./PageHeader";
import "./council-concepts.css";

type Participant = { key: AgentKey; note: string; action: string; today?: string };

// Illustrative copy for the design review. This component is outside the portal navigation.
const participants: Participant[] = [
  { key: "collections", note: "Tienes 2 cobros vencidos por S/ 350 en total.", action: "Ver cobros vencidos", today: "Hoy escaló 1 cobro." },
  { key: "stock", note: "3 productos llegaron al mínimo. Revisa cuáles toca reponer.", action: "Ver productos", today: "Hoy registró 2 movimientos." },
  { key: "sales", note: "Ya vas por el 62 % de tu meta de noviembre.", action: "Ver meta", today: "Hoy registró 2 ventas." },
  { key: "support", note: "1 consulta necesita tu respuesta.", action: "Ver consultas", today: "Hoy pasó 1 consulta a tu equipo." },
  { key: "tender", note: "Hoy encontré 2 licitaciones que podrían encajar con tu negocio.", action: "Ver licitaciones", today: "Hoy encontró 2 licitaciones." },
  { key: "invoice", note: "Todo en orden con tus comprobantes. Me guardo el maullido.", action: "Ver comprobantes", today: "Hoy emitió 4 comprobantes." },
  { key: "reorder", note: "Este puesto está libre. Suma a Reorder Cat para gestionar pedidos a proveedores.", action: "Ver en Plan" },
];

function identity(key: AgentKey) {
  return AGENTS.find((agent) => agent.key === key)!;
}

function Portrait({ participant }: { participant: Participant }) {
  if (!participant.today) {
    return <span className="council-portrait council-portrait-empty" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M7 19h18v4H7zM10 23v4m12-4v4" />
      </svg>
    </span>;
  }
  return <span className="council-portrait">
    <img src={agentLogo(participant.key)} alt="" width={52} height={52} />
  </span>;
}

function Advice({ participant }: { participant: Participant }) {
  const agent = identity(participant.key);
  return <article className="council-advice">
    <Portrait participant={participant} />
    <div className="min-w-0">
      <h3>{agent.name}</h3>
      <p>{participant.note}</p>
      {participant.today && <p className="council-today">{participant.today}</p>}
      <div className="council-links">
        <a href={participant.today ? agent.detail : "/plan"}>{participant.action} <span aria-hidden="true">→</span></a>
        {participant.today && <a href={agent.detail} aria-label={`Ver lo que hizo ${agent.name}`}>Ver lo que hizo</a>}
      </div>
    </div>
  </article>;
}

function RoundTable() {
  return <section aria-labelledby="council-session">
    <div className="council-table-layout">
      <div className="council-table-stage" aria-label="Integrantes del consejo">
        <svg className="council-table-art" viewBox="0 0 440 350" aria-hidden="true">
          <ellipse cx="220" cy="185" rx="134" ry="106" fill="var(--color-forest-dark)" />
          <ellipse cx="220" cy="174" rx="134" ry="106" fill="var(--color-forest)" />
          <ellipse cx="220" cy="174" rx="116" ry="90" fill="none" stroke="var(--color-mint)" strokeOpacity=".35" />
          <path d="M183 174h74m-37-24v48" stroke="var(--color-mint)" strokeOpacity=".2" />
        </svg>
        <span className="council-table-caption">Mesa del<br />consejo</span>
        {participants.map((participant) =>
          <a className="council-seat" key={participant.key} data-seat={participant.key}
            href={participant.today ? `#consejo-${participant.key}` : "/plan"}>
            <Portrait participant={participant} />
            <span>{participant.today ? identity(participant.key).name : "Silla de Reorder Cat"}</span>
          </a>
        )}
      </div>
      <div className="council-brief">
        <header><h2 id="council-session">La sesión de hoy</h2><p>21 de noviembre · 6 gatos activos</p></header>
        <ul>{participants.map((participant) =>
          <li key={participant.key} id={`consejo-${participant.key}`}><Advice participant={participant} /></li>
        )}</ul>
      </div>
    </div>
  </section>;
}

function MeetingMinutes() {
  return <section className="council-minutes" aria-labelledby="council-agenda">
    <header className="council-minutes-header">
      <div><p>21 DE NOVIEMBRE</p><h2 id="council-agenda">Acta de la sesión</h2></div>
      <span>6 gatos activos</span>
    </header>
    <div className="council-agenda">
      <h3>Para atender</h3>
      <ul>{[participants[0], participants[1], participants[3]].map((participant) =>
        <li key={participant.key}><Advice participant={participant} /></li>
      )}</ul>
      <h3>Para seguir de cerca</h3>
      <ul>{[participants[2], participants[4], participants[5]].map((participant) =>
        <li key={participant.key}><Advice participant={participant} /></li>
      )}</ul>
      <footer><Advice participant={participants[6]} /></footer>
    </div>
  </section>;
}

export function CouncilConcepts({ concept }: { concept: "mesa" | "acta" }) {
  return <div className="council-concept space-y-5">
    <PageHeader eyebrow="CREACIONES J&D" title="Tus agentes"
      subtitle={concept === "mesa" ? "Tu consejo de gatos se reúne para mejorar el negocio." : "Lo que tu consejo vio hoy y lo que puedes hacer."} />
    <p className="text-sm font-semibold text-ink-muted">Propuesta visual · Datos de ejemplo</p>
    {concept === "mesa" ? <RoundTable /> : <MeetingMinutes />}
  </div>;
}
