import type {
  RoleHandler,
  RoleHandlerContext,
  TenantContext,
} from "./contracts";
import { extractQuote } from "../quotes/ai-extractor";
import { formatAmountInWords } from "../quotes/amount-in-words";
import { calculateQuoteTotal, renderQuoteHtml } from "../quotes/template";
import { applyQuoteExtraction } from "../quotes/extraction";
import {
  QUOTE_ROLE_KEY,
  type QuoteConfig,
  type QuoteConfigRow,
  type QuoteDraft,
  type QuoteDraftRow,
  type QuoteItemRow,
} from "../quotes/types";

export const QUOTE_SYSTEM_PROMPT = [
  "Eres un asistente experto en cotizaciones para una empresa de cortinas y decoración.",
  "Ayudas a recopilar los datos del cliente y sus productos de forma amable, clara y breve.",
  "No inventes precios, cantidades ni datos fiscales.",
].join(" ");

function isQuoteConfirmation(context: RoleHandlerContext): boolean {
  if (context.message.interactionId === "quote_confirm") {
    return true;
  }
  return /^(confirmar|confirmo|sí|si|s[ií]|ok|dale|enviar)$/iu.test(
    context.message.text.trim(),
  );
}

function isQuoteCancellation(context: RoleHandlerContext): boolean {
  if (context.message.interactionId === "quote_cancel") {
    return true;
  }
  return /^(cancelar|cancelo|no|anular|descartar)$/iu.test(
    context.message.text.trim(),
  );
}

function isNewQuoteRequest(messageText: string): boolean {
  const normalized = messageText.trim();
  return /^(?:necesito|quiero|deseo|prep[aá]rame|g[eé]nerame)\s+(?:una\s+)?cotizaci[oó]n\b/iu.test(
    normalized,
  ) || /^(?:nueva|otra|reiniciar|reinicia)\s+cotizaci[oó]n\b/iu.test(normalized);
}

function hasQuoteData(draft: QuoteDraft): boolean {
  return Boolean(
    draft.customerName.trim() ||
      draft.customerTaxId.trim() ||
      draft.customerPhone.trim() ||
      draft.items.length > 0,
  );
}

function parseServices(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === "string")
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

async function loadQuoteConfig(
  tenantId: string,
  env: Env,
): Promise<QuoteConfig | null> {
  if (!env.DB) {
    return null;
  }

  try {
    const row = await env.DB.prepare(
      `SELECT
         legal_name,
         tax_id,
         address,
         services_json,
         bank_name,
         bank_account,
         bank_cci,
         advisor_name,
         advisor_phone,
         currency,
         tax_rate,
         prices_include_tax,
         valid_days,
         logo_url
       FROM quote_configs
       WHERE tenant_id = ?1
       LIMIT 1`,
    )
      .bind(tenantId)
      .first<QuoteConfigRow>();

    if (!row) {
      return null;
    }

    return {
      legalName: row.legal_name,
      taxId: row.tax_id,
      address: row.address,
      services: parseServices(row.services_json),
      bankName: row.bank_name,
      bankAccount: row.bank_account,
      bankCci: row.bank_cci,
      advisorName: row.advisor_name,
      advisorPhone: row.advisor_phone,
      currency: row.currency || "PEN",
      taxRate:
        Number.isFinite(row.tax_rate) && row.tax_rate >= 0
          ? Math.min(row.tax_rate, 1)
          : 0.18,
      pricesIncludeTax: row.prices_include_tax === 1,
      validDays:
        Number.isInteger(row.valid_days) && row.valid_days > 0
          ? Math.min(row.valid_days, 90)
          : 7,
      logoUrl: row.logo_url?.trim() || null,
    };
  } catch {
    return null;
  }
}

async function loadQuoteDraft(
  tenantId: string,
  contactId: number,
  env: Env,
): Promise<QuoteDraft | null> {
  if (!env.DB) {
    return null;
  }

  try {
    const row = await env.DB.prepare(
      `SELECT
         id,
         tenant_id,
         contact_id,
         status,
         sequence_scope_id,
         quote_number,
         customer_name,
         customer_tax_id,
         customer_phone,
         issued_at,
         expires_at,
         importe_letras
       FROM quote_drafts
       WHERE tenant_id = ?1
         AND contact_id = ?2
         AND status IN ('collecting', 'ready', 'confirmed')
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
      .bind(tenantId, contactId)
      .first<QuoteDraftRow>();

    if (!row) {
      return null;
    }

    const items = await env.DB.prepare(
      `SELECT position, description, quantity, unit_price
       FROM quote_items
       WHERE draft_id = ?1
       ORDER BY position ASC`,
    )
      .bind(row.id)
      .all<QuoteItemRow>();

    return {
      id: row.id,
      tenantId: row.tenant_id,
      contactId: row.contact_id,
      status: row.status,
      sequenceScopeId: row.sequence_scope_id,
      quoteNumber: row.quote_number,
      customerName: row.customer_name,
      customerTaxId: row.customer_tax_id,
      customerPhone: row.customer_phone,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      importeLetras: row.importe_letras,
      items: (items.results ?? []).map((item) => ({
        position: item.position,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
      })),
    };
  } catch {
    return null;
  }
}

async function createQuoteDraft(
  tenantId: string,
  contactId: number,
  env: Env,
  numberAllocator: RoleHandlerContext["quoteNumberAllocator"],
): Promise<QuoteDraft | null> {
  if (!env.DB) {
    return null;
  }

  const id = crypto.randomUUID();
  const scope = numberAllocator
    ? await numberAllocator.getOrCreateScope(tenantId, contactId)
    : null;
  try {
    await env.DB.prepare(
      `INSERT INTO quote_drafts (
         id, tenant_id, contact_id, status, sequence_scope_id
       ) VALUES (?1, ?2, ?3, 'collecting', ?4)`,
    )
      .bind(id, tenantId, contactId, scope?.id ?? null)
      .run();
    return {
      id,
      tenantId,
      contactId,
      status: "collecting",
      sequenceScopeId: scope?.id ?? null,
      quoteNumber: null,
      customerName: "",
      customerTaxId: "",
      customerPhone: "",
      issuedAt: null,
      expiresAt: null,
      importeLetras: "",
      items: [],
    };
  } catch {
    return loadQuoteDraft(tenantId, contactId, env);
  }
}

async function saveQuoteDraft(
  draft: QuoteDraft,
  env: Env,
): Promise<boolean> {
  if (!env.DB) {
    return false;
  }

  try {
    await env.DB.prepare(
      `UPDATE quote_drafts
       SET status = ?2,
           sequence_scope_id = ?3,
           quote_number = ?4,
           customer_name = ?5,
           customer_tax_id = ?6,
           customer_phone = ?7,
           issued_at = ?8,
           expires_at = ?9,
           importe_letras = ?10,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    )
      .bind(
        draft.id,
        draft.status,
        draft.sequenceScopeId,
        draft.quoteNumber,
        draft.customerName,
        draft.customerTaxId,
        draft.customerPhone,
        draft.issuedAt,
        draft.expiresAt,
        draft.importeLetras,
      )
      .run();

    await env.DB.prepare("DELETE FROM quote_items WHERE draft_id = ?1")
      .bind(draft.id)
      .run();

    if (draft.items.length > 0) {
      await env.DB.batch(
        draft.items.map((item) =>
          env.DB.prepare(
            `INSERT INTO quote_items (
               draft_id, position, description, quantity, unit_price
             ) VALUES (?1, ?2, ?3, ?4, ?5)`,
          ).bind(
            draft.id,
            item.position,
            item.description,
            item.quantity,
            item.unitPrice,
          ),
        ),
      );
    }

    return true;
  } catch {
    return false;
  }
}

async function updateQuoteStatus(
  draftId: string,
  status: QuoteDraft["status"],
  lastError: string | null,
  env: Env,
): Promise<void> {
  if (!env.DB) {
    return;
  }

  try {
    await env.DB.prepare(
      `UPDATE quote_drafts
       SET status = ?2, last_error = ?3, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    )
      .bind(draftId, status, lastError)
      .run();
  } catch {
    // Status persistence must not make the webhook fail.
  }
}

function isComplete(draft: QuoteDraft): boolean {
  return draft.customerName.trim().length > 0 && draft.items.length > 0;
}

function formatDraftSummary(
  draft: QuoteDraft,
  extractionMessage: string,
): string {
  const items = draft.items
    .map(
      (item) =>
        `• ${item.quantity} × ${item.description} — S/ ${item.unitPrice.toFixed(2)}`,
    )
    .join("\n");
  const missing = [
    draft.customerName ? null : "el nombre del cliente",
    draft.items.length > 0 ? null : "al menos un producto o servicio",
  ].filter((value): value is string => value !== null);

  return [
    extractionMessage || "He actualizado el borrador.",
    "",
    `Cliente: ${draft.customerName || "pendiente"}`,
    `DNI/RUC: ${draft.customerTaxId || "no indicado"}`,
    `Teléfono: ${draft.customerPhone || "no indicado"}`,
    items ? `\nProductos:\n${items}` : "",
    "",
    missing.length > 0
      ? `Todavía necesito ${missing.join(" y ")}.`
      : "La cotización está lista. Responde confirmar para generar y enviar el PDF, o cancelar para descartarla.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateQuotePdf(
  config: QuoteConfig,
  draft: QuoteDraft,
  context: RoleHandlerContext,
): Promise<Blob | null> {
  if (!context.env.BROWSER) {
    context.log("whatsapp_quotes_pdf_failed", {
      reason: "missing_browser_binding",
    });
    return null;
  }

  try {
    const response = await context.env.BROWSER.quickAction("pdf", {
      html: renderQuoteHtml(config, draft),
      pdfOptions: {
        preferCSSPageSize: true,
        printBackground: true,
        format: "a4",
      },
    });
    if (!response.ok) {
      context.log("whatsapp_quotes_pdf_failed", {
        reason: "browser_run_error",
        status: response.status,
      });
      return null;
    }
    return await response.blob();
  } catch {
    context.log("whatsapp_quotes_pdf_failed", {
      reason: "browser_run_request_error",
    });
    return null;
  }
}

async function cancelActiveDraft(
  tenantId: string,
  contactId: number,
  env: Env,
): Promise<void> {
  const draft = await loadQuoteDraft(tenantId, contactId, env);
  if (draft) {
    await updateQuoteStatus(draft.id, "cancelled", null, env);
  }
}

export class QuoteRoleHandler implements RoleHandler {
  readonly key = QUOTE_ROLE_KEY;

  configure(tenant: TenantContext): TenantContext {
    return {
      ...tenant,
      roleKey: QUOTE_ROLE_KEY,
      systemPrompt: QUOTE_SYSTEM_PROMPT,
      temperature: 0.2,
    };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    const { tenant, persisted, env, message, log } = context;
    if (!env.DB || persisted.contactId === null) {
      await context.reply("No pude abrir una sesión de cotización en este momento.");
      return;
    }

    const config = await loadQuoteConfig(tenant.tenantId, env);
    if (!config) {
      log("whatsapp_quotes_unavailable", {
        reason: "missing_quote_configuration",
      });
      await context.reply(
        "Este cliente todavía no tiene configurada la información de cotizaciones.",
      );
      return;
    }

    if (isQuoteCancellation(context)) {
      await cancelActiveDraft(tenant.tenantId, persisted.contactId, env);
      await context.reply("❌ Cotización cancelada. No se generó ningún documento.");
      return;
    }

    let currentDraft = await loadQuoteDraft(
      tenant.tenantId,
      persisted.contactId,
      env,
    );

    if (currentDraft && isNewQuoteRequest(message.text) && hasQuoteData(currentDraft)) {
      await updateQuoteStatus(
        currentDraft.id,
        "cancelled",
        "superseded_by_new_quote",
        env,
      );
      currentDraft = null;
    }

    if (isQuoteConfirmation(context)) {
      if (!currentDraft || !isComplete(currentDraft)) {
        await context.reply(
          "Todavía faltan datos para confirmar la cotización. Indícame el cliente y al menos un producto o servicio.",
        );
        return;
      }

      const scope = currentDraft.sequenceScopeId
        ? { id: currentDraft.sequenceScopeId }
        : context.quoteNumberAllocator
          ? await context.quoteNumberAllocator.getOrCreateScope(
              tenant.tenantId,
              currentDraft.contactId,
            )
          : null;
      const quoteNumber = currentDraft.quoteNumber ?? (
        scope && context.quoteNumberAllocator
          ? await context.quoteNumberAllocator.allocate(scope.id)
          : null
      );
      if (!quoteNumber) {
        await context.reply(
          "No pude asignar un número de cotización. Intenta nuevamente en un momento.",
        );
        return;
      }

      const issuedAt = currentDraft.issuedAt ?? new Date().toISOString();
      const expiresAt = currentDraft.expiresAt ?? new Date(
        Date.parse(issuedAt) + config.validDays * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const importeLetras =
        currentDraft.importeLetras ||
        formatAmountInWords(calculateQuoteTotal(currentDraft));
      const confirmedDraft: QuoteDraft = {
        ...currentDraft,
        sequenceScopeId: scope?.id ?? currentDraft.sequenceScopeId,
        status: "confirmed",
        quoteNumber,
        issuedAt,
        expiresAt,
        importeLetras,
      };
      if (!(await saveQuoteDraft(confirmedDraft, env))) {
        await context.reply(
          "No pude guardar la confirmación de la cotización. Intenta nuevamente.",
        );
        return;
      }

      const pdf = await generateQuotePdf(config, confirmedDraft, context);
      if (!pdf) {
        await updateQuoteStatus(
          confirmedDraft.id,
          "confirmed",
          "pdf_generation_failed",
          env,
        );
        await context.reply(
          "La cotización quedó confirmada, pero no pude generar el PDF todavía.",
        );
        return;
      }

      const result = await context.sendDocument({
        pdf,
        filename: `Cotizacion-${quoteNumber}.pdf`,
        caption: `Cotización ${quoteNumber} para ${confirmedDraft.customerName}`,
      });
      if (result.status === "sent") {
        await updateQuoteStatus(confirmedDraft.id, "sent", null, env);
        await context.reply(`✅ Cotización ${quoteNumber} generada y enviada en PDF.`);
      } else {
        await updateQuoteStatus(
          confirmedDraft.id,
          "confirmed",
          "document_send_failed",
          env,
        );
        await context.reply(
          `La cotización ${quoteNumber} está confirmada, pero no pude enviarte el PDF. Intenta confirmar nuevamente.`,
        );
      }
      return;
    }

    const draft = currentDraft ?? await createQuoteDraft(
      tenant.tenantId,
      persisted.contactId,
      env,
      context.quoteNumberAllocator,
    );
    if (!draft) {
      await context.reply("No pude crear el borrador de cotización. Intenta nuevamente.");
      return;
    }

    const extraction = await extractQuote(
      message.text,
      draft,
      context.ai,
      tenant.aiModel,
      log,
    );
    if (!extraction) {
      await context.reply(
        "No pude interpretar los datos de la cotización. Intenta indicar cliente, producto, cantidad y precio.",
      );
      return;
    }

    const mergedDraft = applyQuoteExtraction(draft, extraction);
    mergedDraft.status = isComplete(mergedDraft) ? "ready" : "collecting";
    if (!(await saveQuoteDraft(mergedDraft, env))) {
      await context.reply(
        "Entendí el mensaje, pero no pude guardar el borrador. Intenta nuevamente.",
      );
      return;
    }

    await context.reply(
      formatDraftSummary(mergedDraft, extraction.assistantMessage),
    );
  }
}
