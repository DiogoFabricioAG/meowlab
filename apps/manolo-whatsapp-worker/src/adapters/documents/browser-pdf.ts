import type { RoleLog } from "../../roles/contracts";

export type PdfRenderer = (html: string) => Promise<Blob | null>;

/**
 * Renders self-contained print HTML to an A4 PDF with Browser Run.
 * Returns null on any failure so callers can degrade without breaking a turn.
 */
export function createBrowserPdfRenderer(browser: BrowserRun | undefined, log: RoleLog): PdfRenderer | undefined {
  if (!browser) return undefined;
  return async (html) => {
    try {
      const response = await browser.quickAction("pdf", {
        html,
        pdfOptions: { preferCSSPageSize: true, printBackground: true, format: "a4" },
      });
      if (!response.ok) {
        log("whatsapp_pdf_render_failed", { reason: "browser_run_error", status: response.status });
        return null;
      }
      const pdf = await response.blob();
      return pdf.size > 0 ? pdf : null;
    } catch {
      log("whatsapp_pdf_render_failed", { reason: "browser_run_request_error" });
      return null;
    }
  };
}
