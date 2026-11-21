import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "../web/src/PageHeader";

describe("PageHeader", () => {
  it("renders the general variant with fixed-height top row, eyebrow/spacer, title, subtitle and actions", () => {
    const withEyebrow = renderToStaticMarkup(
      createElement(PageHeader, {
        eyebrow: "CREACIONES J&D",
        title: "Tus agentes",
        subtitle: "Resumen de tus gatos.",
        actions: createElement("button", { type: "button" }, "Exportar"),
      }),
    );

    expect(withEyebrow).toContain("h-6");
    expect(withEyebrow).toContain("CREACIONES J&amp;D");
    expect(withEyebrow).toContain("<h1");
    expect(withEyebrow).toContain("text-3xl font-bold tracking-tight text-ink");
    expect(withEyebrow).toContain("Tus agentes");
    expect(withEyebrow).toContain("Resumen de tus gatos.");
    expect(withEyebrow).toContain("Exportar");
    expect(withEyebrow).not.toContain("←");

    const withoutEyebrow = renderToStaticMarkup(
      createElement(PageHeader, { title: "Negocio" }),
    );
    expect(withoutEyebrow).toContain("h-6");
    expect(withoutEyebrow).toContain('aria-hidden="true"');
  });

  it("renders the agent variant with the back link in the fixed-height top row and 48px agent logo", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        onBack: () => {},
        agent: "invoice",
        title: "Invoice Cat",
        subtitle: "Comprobantes de CREACIONES J&D",
      }),
    );

    expect(html).toContain("h-6");
    expect(html).toContain("min-h-11 -my-2.5");
    expect(html).toContain("Tus agentes");
    expect(html).toContain("h-12 w-12");
    expect(html).toContain("/agents/invoice-cat.webp");
    expect(html).toContain("Invoice Cat");
  });
});
