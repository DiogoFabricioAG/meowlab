import { describe, expect, it } from "vitest";
import {
  formatPrintAdvisorResponse,
  PRINT_ADVISOR_ROLE_KEY,
} from "../src/roles/print-advisor-role";
import {
  validateReadOnlySelect,
} from "../src/adapters/print-system/d1-repository";
import { roleRegistry } from "../src/roles/registry";
import type { AiProvider } from "../src/ai/contracts";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import { PrintAdvisorRoleHandler } from "../src/roles/print-advisor-role";

const baseTenant: TenantContext = {
  tenantId: "print-tenant",
  phoneNumberId: "print-phone",
  roleKey: PRINT_ADVISOR_ROLE_KEY,
  systemPrompt: "print advisor",
  aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b",
  temperature: 0.2,
  maxTokens: 1_500,
};

describe("print advisor", () => {
  it("is registered as an assignable role", () => {
    expect(roleRegistry.keys()).toContain(PRINT_ADVISOR_ROLE_KEY);
  });

  it("accepts one read-only SELECT statement", () => {
    expect(
      validateReadOnlySelect(
        "SELECT nombre, SUM(pago) AS total FROM ventas GROUP BY nombre;",
      ),
    ).toEqual({
      valid: true,
      query: "SELECT nombre, SUM(pago) AS total FROM ventas GROUP BY nombre",
    });
  });

  it.each([
    "UPDATE ventas SET pago = 0",
    "SELECT 1; DELETE FROM ventas",
    "SELECT 1 -- bypass",
    "PRAGMA table_info(ventas)",
  ])("rejects unsafe SQL: %s", (query) => {
    expect(validateReadOnlySelect(query).valid).toBe(false);
  });

  it("converts table JSON into a WhatsApp-friendly response", () => {
    const formatted = formatPrintAdvisorResponse(
      JSON.stringify({
        type: "table",
        message: "Ventas por cliente:",
        data: {
          table: {
            title: "Este mes",
            columns: ["id", "Cliente", "Total"],
            rows: [[17, "Ana", 125.5]],
          },
        },
      }),
    );

    expect(formatted).toContain("📋 Este mes");
    expect(formatted).toContain("Cliente: Ana | Total: 125.50");
    expect(formatted).not.toContain("17");
  });

  it("keeps D1 rows when the model returns only a summary", () => {
    const formatted = formatPrintAdvisorResponse(
      JSON.stringify({
        type: "text",
        message: "Clientes con mayor número de ventas y gasto total",
        data: {},
      }),
      [{ nombre: "Ana", numero_ventas: 4, gasto_total: 850 }],
    );

    expect(formatted).toContain("Clientes con mayor número de ventas");
    expect(formatted).toContain("Nombre: Ana | Numero Ventas: 4 | Gasto Total: 850");
  });

  it("hides technical identifiers from fallback rows", () => {
    const formatted = formatPrintAdvisorResponse(
      JSON.stringify({ type: "text", message: "Resumen", data: {} }),
      [{ id: 3, cliente_id: 9, nombre: "Ana", total: 850 }],
    );

    expect(formatted).toContain("Nombre: Ana | Total: 850");
    expect(formatted).not.toContain("Id:");
    expect(formatted).not.toContain("Cliente Id:");
  });

  it("queries D1 through the provider tool loop before replying", async () => {
    const queries: string[] = [];
    let completionCount = 0;
    const ai: AiProvider = {
      key: "groq",
      complete: async () =>
        JSON.stringify({
          type: "text",
          message: "La venta total fue S/ 125.50.",
          data: {},
        }),
      completeWithTools: async () => {
        completionCount += 1;
        if (completionCount === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: "call-1",
                name: "query_database",
                arguments: JSON.stringify({
                  query: "SELECT nombre, SUM(pago) AS total FROM ventas GROUP BY nombre",
                }),
              },
            ],
          };
        }
        return { content: null, toolCalls: [] };
      },
    };
    const replies: string[] = [];
    const context: RoleHandlerContext = {
      message: {
        id: "message-1",
        interactionId: null,
        phoneNumberId: "print-phone",
        to: "51999999999",
        inputType: "text",
        audioMediaId: null,
        audioMimeType: null,
        text: "¿Cuánto vendimos?",
      },
      tenant: baseTenant,
      persisted: { duplicate: false, conversationId: "conversation-1", contactId: 1 },
      env: {} as Env,
      ai,
      finance: null,
      businessData: {
        executeReadOnlyQuery: async (query) => {
          queries.push(query);
          return { rows: [{ nombre: "Ana", total: 125.5 }] };
        },
      },
      quoteNumberAllocator: null,
      history: [],
      reply: async (replyText) => {
        replies.push(replyText);
      },
      sendDocument: async () => ({
        status: "sent" as const,
        metaMessageId: "document-1",
      }),
      generateAiReply: async () => null,
      generateAiReplyWithHistory: async () => null,
      fallbackReply: "fallback",
      log: () => undefined,
    };

    await new PrintAdvisorRoleHandler().handle(context);

    expect(queries).toEqual([
      "SELECT nombre, SUM(pago) AS total FROM ventas GROUP BY nombre",
    ]);
    expect(replies[0]).toContain("La venta total fue S/ 125.50.");
    expect(replies[0]).toContain("Nombre: Ana | Total: 125.50");
  });

  it("instructs the model to use PostgreSQL when that repository is active", async () => {
    let systemPrompt = "";
    const ai: AiProvider = {
      key: "groq",
      complete: async () => null,
      completeWithTools: async (request) => {
        const content = request.messages[0]?.content;
        systemPrompt = typeof content === "string" ? content : "";
        return {
          content: JSON.stringify({
            type: "text",
            message: "No hace falta consultar datos para esta prueba.",
            data: {},
          }),
          toolCalls: [],
        };
      },
    };
    const context: RoleHandlerContext = {
      message: {
        id: "message-postgres",
        interactionId: null,
        phoneNumberId: "print-phone",
        to: "51999999999",
        inputType: "text",
        text: "Hola",
      },
      tenant: {
        ...baseTenant,
        systemPrompt: new PrintAdvisorRoleHandler().configure(baseTenant).systemPrompt,
      },
      persisted: {
        duplicate: false,
        conversationId: "conversation-postgres",
        contactId: 1,
      },
      env: {} as Env,
      ai,
      finance: null,
      businessData: {
        dialect: "postgres",
        executeReadOnlyQuery: async () => ({ rows: [] }),
      },
      quoteNumberAllocator: null,
      history: [],
      reply: async () => undefined,
      sendDocument: async () => ({ status: "sent", metaMessageId: null }),
      generateAiReply: async () => null,
      generateAiReplyWithHistory: async () => null,
      fallbackReply: "fallback",
      log: () => undefined,
    };

    await new PrintAdvisorRoleHandler().handle(context);

    expect(systemPrompt).toContain("PostgreSQL 16");
    expect(systemPrompt).toContain("NULLIF(fecha, '')::date");
    expect(systemPrompt).toContain("nunca consultes un único total");
    expect(systemPrompt).not.toContain("Motor SQL actual: SQLite");
  });
});
