import { PLAN_FAQS } from "./planCatalog";
import { Icon } from "./icons";

export function PlanTrustSection() {
  return (
    <section className="rounded-3xl border border-line bg-white p-6 shadow-card" aria-label="Pagos y garantías">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h3 className="text-lg text-ink">Pagos seguros y sin contratos</h3>
          <p className="text-sm text-ink-muted">
            Precios en soles con IGV incluido. Cancela cuando quieras desde aquí, sin permanencia ni penalidades.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5" aria-label="Medios de pago aceptados">
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-ink">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#009ee3]" />
            Mercado Pago
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-ink">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#742284]" />
            Yape
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-ink">
            <Icon name="card" className="h-3.5 w-3.5 text-forest" />
            Tarjetas Visa / Mastercard
          </span>
        </div>
      </div>
    </section>
  );
}

export function PlanFaqSection() {
  return (
    <section className="space-y-4" aria-labelledby="plan-faq-title">
      <h3 id="plan-faq-title" className="text-xl text-ink">Preguntas frecuentes</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {PLAN_FAQS.map((item) => (
          <article key={item.question} className="rounded-3xl border border-line bg-white p-5 shadow-card">
            <h4 className="font-sans text-base font-semibold text-ink">{item.question}</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
