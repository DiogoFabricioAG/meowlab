export type CatalogAgent = {
  key: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
};

export type Discount = { minAgents: number; percent: number };

export type Quote = {
  agents: string[];
  subtotalCents: number;
  discountPercent: number;
  totalCents: number;
};

export class PricingError extends Error {
  constructor(readonly code: "empty" | "unknown_agent" | "unavailable_agent" | "duplicate_agent") {
    super(code);
  }
}

/** Discount for n active agents: the highest tier whose minimum is <= n. */
export function discountFor(count: number, discounts: readonly Discount[]): number {
  return discounts
    .filter((tier) => tier.minAgents <= count)
    .reduce((best, tier) => (tier.minAgents > best.minAgents ? tier : best), { minAgents: 0, percent: 0 }).percent;
}

/** Server-side price: the client only chooses agents, never the amount. Rounded to the céntimo. */
export function quote(requested: readonly string[], catalog: readonly CatalogAgent[], discounts: readonly Discount[]): Quote {
  if (requested.length === 0) throw new PricingError("empty");
  if (new Set(requested).size !== requested.length) throw new PricingError("duplicate_agent");
  const byKey = new Map(catalog.map((agent) => [agent.key, agent]));
  const agents = requested.map((key) => {
    const agent = byKey.get(key);
    if (!agent) throw new PricingError("unknown_agent");
    if (!agent.available) throw new PricingError("unavailable_agent");
    return agent;
  });
  const subtotalCents = agents.reduce((sum, agent) => sum + agent.priceCents, 0);
  const discountPercent = discountFor(agents.length, discounts);
  const totalCents = Math.round((subtotalCents * (100 - discountPercent)) / 100);
  const order = new Map(catalog.map((agent, index) => [agent.key, index]));
  return {
    agents: agents.map((agent) => agent.key).sort((a, b) => order.get(a)! - order.get(b)!),
    subtotalCents,
    discountPercent,
    totalCents,
  };
}

/** One month later on the same calendar day, clamped to the month's last day. */
export function addOneMonth(date: Date): Date {
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}
