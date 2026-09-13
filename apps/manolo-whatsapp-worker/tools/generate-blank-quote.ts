import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderQuoteHtml } from "../src/quotes/template";
import type { QuoteConfig, QuoteDraft } from "../src/quotes/types";

const root = resolve(process.cwd());
const outputHtml = resolve(root, "tmp/pdfs/Cotizacion-Vacia-Manolo.html");
const outputDir = dirname(outputHtml);
mkdirSync(outputDir, { recursive: true });

const logo = readFileSync(resolve(root, "public/logo.png")).toString("base64");
const config: QuoteConfig = {
  legalName: "VENTA DE TELAS, TAPASOLES, TULES EXCLUSIVOS PARA CORTINAS",
  taxId: "10088195847",
  address: "Jr. Gamarra 653 2do Sotano Tda. 1 Galeria Plaza La Victoria",
  services: [
    "CONFECCIONAMOS CORTINAS, ESTORES, ONDAS DRAPEADAS Y ROLLERS",
    "PERSIANAS VERTICALES, HORIZONTALES DE MADERA, PUERTA PLEGADIZA",
    "TAPICERIA, FABRICACION DE MUEBLES DE MELAMINE",
    "VIDRIOS TEMPLADOS PARA BAÑOS",
  ],
  bankName: "BCP",
  bankAccount: "19124261433097",
  bankCci: "00219112426143309752",
  advisorName: "Antonio Larrauri",
  advisorPhone: "995446540",
  currency: "PEN",
  taxRate: 0.18,
  pricesIncludeTax: true,
  validDays: 7,
  logoUrl: `data:image/png;base64,${logo}`,
};

const draft: QuoteDraft = {
  id: "blank-template",
  tenantId: "manolo",
  contactId: 0,
  status: "collecting",
  sequenceScopeId: null,
  quoteNumber: "________________",
  customerName: "",
  customerTaxId: "",
  customerPhone: "",
  issuedAt: "________________",
  expiresAt: "________________",
  importeLetras: "________________________________________",
  items: [],
};

const html = renderQuoteHtml(config, draft)
  .replace(
    "Añade productos desde el chat para verlos aquí",
    "&nbsp;<br><br>&nbsp;",
  );
writeFileSync(outputHtml, html, "utf8");
console.log(outputHtml);
