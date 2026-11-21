import { describe, expect, it } from "vitest";
import { quote, type CatalogAgent, type Discount } from "../server/billing/pricing";
import { AGENT_PITCH, PLAN_BUNDLES, PLAN_FAQS, calculatePlanQuote, nextDiscountNudge } from "../web/src/planCatalog";
import { AGENTS } from "../web/src/agents";

const CATALOG: CatalogAgent[] = [
  { key: "invoice", name: "Invoice Cat", description: "", priceCents: 3900, available: true },
  { key: "sales", name: "Sales Cat", description: "", priceCents: 5900, available: true },
  { key: "stock", name: "Stock Cat", description: "", priceCents: 2900, available: true },
  { key: "reorder", name: "Reorder Cat", description: "", priceCents: 2500, available: true },
  { key: "support", name: "Support Cat", description: "", priceCents: 3900, available: true },
  { key: "collections", name: "Collections Cat", description: "", priceCents: 2500, available: true },
  { key: "tender", name: "Tender Cat", description: "", priceCents: 3500, available: true },
];

const DISCOUNTS: Discount[] = [
  { minAgents: 1, percent: 0 },
  { minAgents: 2, percent: 10 },
  { minAgents: 3, percent: 15 },
  { minAgents: 5, percent: 20 },
];

describe("planCatalog (T6 Plan sales page)", () => {
  it("matches server/billing/pricing.ts quote() across bundles and agent counts", () => {
    for (const bundle of PLAN_BUNDLES) {
      const keys = bundle.keys(CATALOG);
      const clientQuote = calculatePlanQuote(keys, CATALOG, DISCOUNTS);
      const serverQuote = quote(keys, CATALOG, DISCOUNTS);
      expect(clientQuote.subtotalCents).toBe(serverQuote.subtotalCents);
      expect(clientQuote.discountPercent).toBe(serverQuote.discountPercent);
      expect(clientQuote.totalCents).toBe(serverQuote.totalCents);
      expect(clientQuote.savingsCents).toBe(serverQuote.subtotalCents - serverQuote.totalCents);
    }

    for (let n = 1; n <= CATALOG.length; n++) {
      const keys = CATALOG.slice(0, n).map((a) => a.key);
      const clientQuote = calculatePlanQuote(keys, CATALOG, DISCOUNTS);
      const serverQuote = quote(keys, CATALOG, DISCOUNTS);
      expect(clientQuote.totalCents).toBe(serverQuote.totalCents);
      expect(clientQuote.discountPercent).toBe(serverQuote.discountPercent);
    }
  });

  it("computes the next discount nudge accurately", () => {
    expect(nextDiscountNudge(0, DISCOUNTS)).toEqual({ needed: 2, nextPercent: 10 });
    expect(nextDiscountNudge(1, DISCOUNTS)).toEqual({ needed: 1, nextPercent: 10 });
    expect(nextDiscountNudge(2, DISCOUNTS)).toEqual({ needed: 1, nextPercent: 15 });
    expect(nextDiscountNudge(3, DISCOUNTS)).toEqual({ needed: 2, nextPercent: 20 });
    expect(nextDiscountNudge(4, DISCOUNTS)).toEqual({ needed: 1, nextPercent: 20 });
    expect(nextDiscountNudge(5, DISCOUNTS)).toBeNull();
  });

  it("provides idealIf and 3 benefits for every agent and all 4 FAQs", () => {
    for (const agent of AGENTS) {
      const pitch = AGENT_PITCH[agent.key];
      expect(pitch.idealIf.length).toBeGreaterThan(5);
      expect(pitch.benefits).toHaveLength(3);
    }
    expect(PLAN_FAQS).toHaveLength(4);
  });
});
