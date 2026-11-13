import type { RadarAlertContext } from "./presentation";
import type { FollowUpAction } from "./follow-up";

const date = (s: string) => Number.isFinite(Date.parse(s))
  ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "long", timeStyle: "short" }).format(Date.parse(s)) : "Por confirmar";

/** Expanded facts for the selected delivery. Sent as text to preserve document/source URLs. */
export function opportunityDetail(context: RadarAlertContext): string {
  const { alert, evidence } = context;
  const plain = (value: string, max: number) => value.replace(/[*_~`]/gu, "").replace(/\s+/gu, " ").trim().slice(0, max);
  const itemDescription = (value: string) => {
    const full = plain(value, 500);
    // Some published "items" repeat the entire project name. Retain its literal
    // purchase clause, not the project boilerplate already explained in the alert.
    const core = full.split(/\b(?:seg[úu]n\s+(?:requerimiento|especificaciones)|para\s+(?:el|la)\s+(?:proyecto|obra|meta))\b/iu)[0]!.replace(/[,;:\s]+$/u, "");
    return full.length > 180 && core.length >= 15 ? core : full;
  };
  const items = evidence?.items.slice(0, 5).map(item => {
    const quantity = item.quantity === null ? "Cantidad por confirmar" : `${new Intl.NumberFormat("es-PE", {
      notation: item.quantity > 1e12 ? "scientific" : "standard",
    }).format(item.quantity)} ${item.unit ? plain(item.unit, 60) : "(unidad por confirmar)"}`;
    return `• ${itemDescription(item.description)}\n  ${quantity}`;
  }) ?? [];
  const dated = (label: string, value: string) => `${label}: ${date(value)}${Date.parse(value) < Date.now() ? " — plazo transcurrido" : ""}`;
  const dates = evidence?.registrationDeadline || evidence?.offerDeadline
    ? [evidence.registrationDeadline ? dated("Registro de participantes", evidence.registrationDeadline) : "",
      evidence.offerDeadline ? dated("Presentación de ofertas", evidence.offerDeadline) : ""].filter(Boolean).join("\n")
    : `Fecha publicada: ${date(alert.deadline)} (etapa por confirmar)`;
  const documents = evidence?.documents.slice(0, 2).map(document => `• ${plain(document.title, 160)}\n${document.url}`);
  const source = evidence ? `Fuente SEACE (ficha del proceso):\n${evidence.sourceUrl}`
    : `Ficha específica pendiente de verificar. Buscador oficial SEACE:\nhttps://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml\nBusca: ${plain(alert.code, 200)}`;
  const render = () => ["*Detalle de la convocatoria*", `*Entidad*\n${plain(alert.buyer, 300)}`,
    `*Productos y cantidades*\n${items.length ? items.join("\n\n") : "El aviso no incluye el desglose de productos ni cantidades."}${evidence && evidence.items.length > items.length ? "\nHay más ítems en la ficha oficial." : ""}`,
    `*Fechas · hora de Perú*\n${dates}`, `*Monto*\n${plain(alert.amount, 100)}`,
    `*Documentos publicados*\n${documents?.length ? documents.join("\n\n") : "No hay documentos adjuntos en la evidencia recibida."}${evidence && evidence.documents.length > 2 ? "\nMás documentos en la ficha oficial." : ""}`,
    "Requisitos y plazo de entrega: pendientes de verificar en las bases.", source,
    "Puedes marcar «Me interesa» en el aviso o preguntarme por un ítem concreto."].join("\n\n");
  // Keep whole item descriptions and complete links. Limit the number of items,
  // rather than silently cutting the source at the old interactive-message limit.
  while (items.length > 1 && render().length > 3400) items.pop();
  return render();
}

/** Reserve space for the verified source even when the model uses its entire budget. */
export function summaryWithSource(summary: string, context: RadarAlertContext): string {
  const { alert, evidence } = context;
  // WhatsApp uses *bold*, not Markdown **bold**. Facts never inherit model markup.
  const plain = (s: string) => s.replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();
  const clip = (s: string, limit: number) => limit <= 0 ? "" : s.length > limit ? `${s.slice(0, limit - 1).trimEnd()}…` : s;
  const shortDate = (s: string) => Number.isFinite(Date.parse(s))
    ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(Date.parse(s))
    : "Por confirmar";
  const source = context.evidence
    ? `Fuente SEACE (ficha del proceso):\n${context.evidence.sourceUrl}`
    : `Ficha específica pendiente de verificar. Buscador oficial SEACE:\nhttps://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml\nBusca: ${context.alert.code}`;
  const quantities = evidence?.items.filter(i => i.quantity !== null).slice(0, 3)
    .map(i => `• ${new Intl.NumberFormat("es-PE", { notation: i.quantity! > 1e12 ? "scientific" : "standard" }).format(i.quantity!)} ${clip(plain(i.unit ?? "(unidad por confirmar)"), 28)}${evidence.items.length > 1 ? ` — ${clip(plain(i.description), 40)}` : ""}`);
  const dates = evidence?.registrationDeadline || evidence?.offerDeadline
    ? [evidence.registrationDeadline ? `Registro de participantes: ${shortDate(evidence.registrationDeadline)}` : "",
      evidence.offerDeadline ? `Presentación de ofertas: ${shortDate(evidence.offerDeadline)}` : ""].filter(Boolean).join("\n")
    : `Fecha del aviso: ${shortDate(alert.deadline)} (etapa por confirmar)`;
  const facts = [
    quantities?.length ? `*Cantidad*\n${quantities.join("\n")}${evidence!.items.length > 3 ? "\nMás ítems en la ficha." : ""}` : "",
    `*Entidad*\n${clip(plain(alert.buyer), 100)}`,
    `*Fechas clave · hora Perú*\n${dates}`,
    `*Monto*\n${clip(plain(alert.amount), 60)}`,
  ].filter(Boolean).join("\n\n");
  // The complete source and factual dates have priority over the generated overview.
  const budget = Math.min(240, Math.max(0, 1024 - source.length - facts.length - 22));
  const text = clip(plain(summary), budget);
  return `${text ? `*Qué compran*\n${text}\n\n` : ""}${facts}\n\n${source}`;
}

/** Factual per-action answers remain useful when generation is unavailable. */
export function actionAnswer(context: RadarAlertContext, action?: FollowUpAction): string {
  const { alert, evidence } = context;
  if (action === "source") {
    if (!evidence) return `Todavía no tengo una ficha específica verificada para este aviso. Este es el buscador oficial, no la ficha del proceso:\n${alert.sourceUrl}\nBusca: ${alert.code}.`;
    const bases = evidence.documents.find(d => /bases integradas/i.test(d.title)) ?? evidence.documents.find(d => /bases/i.test(d.title));
    return `Ficha oficial de ${alert.code}:\n${evidence.sourceUrl}${bases ? `\n\n${bases.title}:\n${bases.url}` : ""}`;
  }
  if (action === "products") {
    const products = evidence?.items.slice(0, 3).map(i => `• ${i.description.slice(0, 180)}${i.quantity !== null ? `: ${new Intl.NumberFormat("es-PE").format(i.quantity)}${i.unit ? ` ${i.unit}` : ""}` : ": cantidad por confirmar"}`).join("\n");
    return products
      ? `Productos publicados en la ficha:\n${products}\n\nLa ficha resumida no acredita tallas, materiales ni distribución. Revisa las bases integradas desde «Ver fuente oficial» para confirmarlos. ¿Puedes atender esta cantidad?`
      : `El objeto publicado es: ${alert.description.slice(0, 300)}. No tengo aún el detalle de ítems ni cantidades; no sería correcto deducirlos del título. ¿Tienes las bases para revisar lo solicitado?`;
  }
  if (action === "evaluate") return `Para evaluar esta oportunidad, primero contrastemos tu capacidad con ${evidence?.items[0]?.quantity != null ? `las ${new Intl.NumberFormat("es-PE").format(evidence.items[0].quantity)} unidades publicadas` : "el producto solicitado"}. Después habrá que verificar especificaciones, plazo de entrega y costos en las bases. ¿Fabricas o comercializas este producto y qué volumen puedes atender?`;
  const deadlines = evidence?.registrationDeadline || evidence?.offerDeadline
    ? [evidence.registrationDeadline ? `Registro de participantes: hasta ${date(evidence.registrationDeadline)}.` : "",
      evidence.offerDeadline ? `Presentación de ofertas: hasta ${date(evidence.offerDeadline)}.` : ""].filter(Boolean).join("\n")
    : `Fecha indicada en el aviso: ${date(alert.deadline)}. La etapa debe confirmarse en el cronograma.`;
  return `${alert.description.slice(0, 250)}\n\nEntidad: ${alert.buyer.slice(0, 160)}.\n${deadlines}\n${alert.amount === "Monto por confirmar" ? "El monto referencial no está confirmado." : `Monto informado: ${alert.amount}.`}\n\nPuedes revisar los productos o abrir la ficha y bases desde los botones.`;
}
