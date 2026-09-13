import type {
  AiMessage,
  AiTool,
  AiToolCall,
} from "../ai/contracts";
import type { BusinessSqlDialect } from "../business/contracts";
import type {
  RoleHandler,
  RoleHandlerContext,
  TenantContext,
} from "./contracts";

export const PRINT_ADVISOR_ROLE_KEY = "print-advisor";
export const PRINT_ADVISOR_PROVIDER = "groq";

const MAX_HISTORY_MESSAGES = 20;
const MAX_REPLY_LENGTH = 3_500;
const QUERY_DATABASE_TOOL: AiTool = {
  type: "function",
  function: {
    name: "query_database",
    description:
      "Ejecuta una consulta SQL SELECT de solo lectura en la base de datos del negocio. Úsala para ventas, clientes, pagos, compras, gastos, activos fijos y variables del negocio.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Consulta SQL SELECT válida para el motor indicado en las instrucciones.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

function dialectInstruction(dialect: BusinessSqlDialect): string {
  return dialect === "postgres"
    ? "Motor SQL actual: PostgreSQL 16 con el esquema print_system en el search_path. Para fechas usa CURRENT_DATE, DATE_TRUNC e intervalos de PostgreSQL. La columna ventas.fecha es texto ISO; conviértela con NULLIF(fecha, '')::date y usa creado_el::date como respaldo."
    : "Motor SQL actual: SQLite. Para fechas usa date(), strftime() y modificadores de fecha de SQLite.";
}

export function buildPrintAdvisorSystemPrompt(
  now = new Date(),
  dialect: BusinessSqlDialect = "sqlite",
): string {
  return [
    "Eres Gamarra Bot, un asesor virtual de datos para un negocio de impresión.",
    `Fecha actual del sistema: ${now.toISOString().split("T")[0]}. Usa esta fecha para inferir rangos relativos como hoy, esta semana, este mes o este año.`,
    "Tu trabajo es analizar ventas, clientes, pagos, gastos y activos del negocio con datos reales de la base de datos.",
    "Solo puedes consultar datos: nunca insertes, modifiques ni elimines registros.",
    "Usa la herramienta query_database para obtener los datos antes de responder una pregunta analítica. No inventes resultados.",
    "Para preguntas comparativas (por ejemplo, mes anterior frente al mes actual, esta semana frente a la anterior o vamos bien/mal), nunca consultes un único total. Ejecuta una consulta que devuelva ambos períodos en filas o columnas claramente identificadas, sus cantidades de ventas, sus totales, la diferencia absoluta y la variación porcentual cuando sea posible. Indica siempre que el período actual puede estar incompleto.",
    "Si el usuario pregunta si el negocio va bien o mal, compara los períodos con una métrica concreta y explica brevemente la conclusión; no respondas solo con un total aislado.",
    dialectInstruction(dialect),
    "Esquema de datos:",
    "- clientes(id, nombre, numero, descripcion, creado_el)",
    "- ventas(id, diseño, cliente_id, cantidad, metro_total, maquina, pago, estado, nota, creado_el, fecha, costo_por_metro)",
    "- pagos(id, cliente_id, pago, nota, fecha)",
    "- compras(id, tipo, categoria, monto, notas, creado_el). Los gastos operativos son compras con tipo = 'GASTO'.",
    "- activos_fijos(id, nombre, valor_compra, tasa_depreciacion_anual, fecha_compra)",
    "- variables_negocio(id, clave, valor)",
    "Relaciona ventas y pagos con clientes mediante cliente_id. Para fechas de ventas usa la fecha ISO convertida al tipo fecha; en PostgreSQL usa COALESCE(NULLIF(fecha, '')::date, creado_el::date) y en SQLite usa COALESCE(NULLIF(fecha, ''), date(creado_el)).",
    "La moneda es el sol peruano (S/). Explica los cálculos brevemente y responde en español claro.",
    "Cuando tengas una lista o un reporte, devuelve type=table o type=chart. Para una respuesta puntual usa type=text.",
    "No muestres identificadores técnicos como id, cliente_id, tenant_id ni nombres internos de programación; presenta solo información útil para una persona que administra el negocio.",
    'Devuelve únicamente JSON válido con esta forma: {"type":"text|table|chart","message":"...","data":{}}. No uses Markdown fuera del JSON.',
    "Si la pregunta no trata sobre este negocio, responde que solo puedes ayudar con sus datos y análisis.",
  ].join(" ");
}

function applyDatabaseDialect(
  systemPrompt: string,
  dialect: BusinessSqlDialect,
): string {
  return systemPrompt.replace(
    dialectInstruction("sqlite"),
    dialectInstruction(dialect),
  );
}

type AdvisorResponse = {
  type: "text" | "table" | "chart";
  message: string;
  data?: {
    table?: {
      columns?: unknown;
      rows?: unknown;
      title?: unknown;
    };
    chart?: {
      labels?: unknown;
      values?: unknown;
      title?: unknown;
    };
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(
  toolCall: AiToolCall,
): { query: string } | null {
  try {
    const parsed: unknown = JSON.parse(toolCall.arguments || "{}");
    if (!isRecord(parsed) || typeof parsed.query !== "string") {
      return null;
    }
    return { query: parsed.query };
  } catch {
    return null;
  }
}

function cleanJsonCandidate(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function isTechnicalColumn(column: string): boolean {
  const normalized = column.trim().toLocaleLowerCase("es");
  return normalized === "id" || normalized.endsWith("_id");
}

function formatTable(response: AdvisorResponse): string {
  const table = response.data?.table;
  const columns = Array.isArray(table?.columns)
    ? table.columns.filter((column): column is string => typeof column === "string")
    : [];
  const visibleColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !isTechnicalColumn(column));
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const title = typeof table?.title === "string" ? table.title.trim() : "";
  const lines = [
    ...(title ? [`📋 ${title}`] : []),
    response.message,
  ];

  for (const rawRow of rows.slice(0, 25)) {
    if (!Array.isArray(rawRow)) {
      continue;
    }
    const fields = visibleColumns.map(({ column, index }) =>
      `${column}: ${toDisplayValue(rawRow[index])}`,
    );
    if (fields.length === 0) {
      continue;
    }
    lines.push(`• ${fields.join(" | ")}`);
  }

  return lines.filter(Boolean).join("\n");
}

function formatChart(response: AdvisorResponse): string {
  const chart = response.data?.chart;
  const labels = Array.isArray(chart?.labels) ? chart.labels : [];
  const values = Array.isArray(chart?.values) ? chart.values : [];
  const title = typeof chart?.title === "string" ? chart.title.trim() : "";
  const lines = [
    ...(title ? [`📊 ${title}`] : []),
    response.message,
  ];

  labels.slice(0, 25).forEach((label, index) => {
    lines.push(`• ${toDisplayValue(label)}: ${toDisplayValue(values[index])}`);
  });
  return lines.filter(Boolean).join("\n");
}

function humanizeColumn(column: string): string {
  return column
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatRawRows(rows: readonly Record<string, unknown>[]): string {
  const columns = [
    ...new Set(rows.flatMap((row) => Object.keys(row))),
  ].filter((column) => !isTechnicalColumn(column)).slice(0, 8);
  if (columns.length === 0) {
    return "";
  }

  const lines = ["📌 Datos encontrados:"];
  for (const row of rows.slice(0, 25)) {
    const fields = columns.map(
      (column) => `${humanizeColumn(column)}: ${toDisplayValue(row[column])}`,
    );
    lines.push(`• ${fields.join(" | ")}`);
  }
  return lines.join("\n");
}

function hasStructuredData(response: AdvisorResponse): boolean {
  if (response.type === "table") {
    return Array.isArray(response.data?.table?.rows) &&
      response.data.table.rows.length > 0;
  }
  if (response.type === "chart") {
    return Array.isArray(response.data?.chart?.labels) &&
      response.data.chart.labels.length > 0;
  }
  return false;
}

export function formatPrintAdvisorResponse(
  content: string,
  fallbackRows: readonly Record<string, unknown>[] = [],
): string {
  const candidate = cleanJsonCandidate(content);
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!isRecord(parsed) || typeof parsed.message !== "string") {
      const rawResponse = content.trim().slice(0, MAX_REPLY_LENGTH);
      const rawData = formatRawRows(fallbackRows);
      return [rawResponse, rawData].filter(Boolean).join("\n\n").slice(0, MAX_REPLY_LENGTH);
    }

    const response: AdvisorResponse = {
      type:
        parsed.type === "table" || parsed.type === "chart"
          ? parsed.type
          : "text",
      message: parsed.message.trim(),
      data: isRecord(parsed.data) ? parsed.data as AdvisorResponse["data"] : null,
    };

    const formatted =
      response.type === "table"
        ? formatTable(response)
        : response.type === "chart"
          ? formatChart(response)
          : response.message;
    const fallbackData = hasStructuredData(response)
      ? ""
      : formatRawRows(fallbackRows);
    return [formatted.trim(), fallbackData]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, MAX_REPLY_LENGTH);
  } catch {
    const rawResponse = content.trim().slice(0, MAX_REPLY_LENGTH);
    const rawData = formatRawRows(fallbackRows);
    return [rawResponse, rawData].filter(Boolean).join("\n\n").slice(0, MAX_REPLY_LENGTH);
  }
}

export type PrintAdvisorExecutionContext = Pick<
  RoleHandlerContext,
  "tenant" | "ai" | "businessData" | "history" | "log"
> & {
  messageText: string;
};

function buildMessages(
  context: PrintAdvisorExecutionContext,
  systemPrompt: string,
): AiMessage[] {
  const history = context.history.slice(-MAX_HISTORY_MESSAGES);
  return [
    { role: "system", content: systemPrompt },
    ...history.map((item): AiMessage => ({
      role: item.role,
      content: item.content,
    })),
    { role: "user", content: context.messageText },
  ];
}

export async function generatePrintAdvisorReply(
  context: PrintAdvisorExecutionContext,
): Promise<string> {
  if (!context.ai?.completeWithTools) {
    return "Este asesor todavía no tiene conectado su modelo de análisis.";
  }
  if (!context.businessData) {
    return "Todavía no tengo conectada la base de datos del negocio.";
  }

  const dialect = context.businessData.dialect ?? "sqlite";
  const messages = buildMessages(
    context,
    applyDatabaseDialect(context.tenant.systemPrompt, dialect),
  );
  const result = await context.ai.completeWithTools(
    {
      model: context.tenant.aiModel,
      messages,
      temperature: context.tenant.temperature,
      maxTokens: context.tenant.maxTokens,
      tools: [QUERY_DATABASE_TOOL],
      toolChoice: "auto",
    },
    context.log,
  );

  if (!result) {
    return "No pude consultar al asesor en este momento. Intenta nuevamente en unos segundos.";
  }

  const toolCall = result.toolCalls[0];
  if (!toolCall) {
    return result.content
      ? formatPrintAdvisorResponse(result.content)
      : "No pude construir una respuesta con los datos consultados.";
  }

  messages.push({
    role: "assistant",
    content: result.content,
    toolCalls: [toolCall],
  });

  const argumentsValue = parseToolArguments(toolCall);
  const toolResult =
    toolCall.name !== QUERY_DATABASE_TOOL.function.name
      ? { rows: [], error: "Herramienta no soportada." }
      : argumentsValue
        ? await context.businessData.executeReadOnlyQuery(argumentsValue.query)
        : { rows: [], error: "La herramienta recibió argumentos inválidos." };

  messages.push({
    role: "tool",
    content: JSON.stringify(
      toolResult.rows.length > 0
        ? toolResult.rows
        : toolResult.error
          ? { error: toolResult.error }
          : { message: "No se encontraron resultados." },
    ),
    toolCallId: toolCall.id,
    name: toolCall.name,
  });

  const finalContent = await context.ai.complete(
    {
      model: context.tenant.aiModel,
      messages,
      temperature: context.tenant.temperature,
      maxTokens: context.tenant.maxTokens,
      reasoningEffort: "low",
      responseFormat: { type: "json_object" },
    },
    context.log,
  );

  return finalContent
    ? formatPrintAdvisorResponse(finalContent, toolResult.rows)
    : toolResult.rows.length > 0
      ? formatRawRows(toolResult.rows)
      : "No pude construir una respuesta con los datos consultados.";
}

export class PrintAdvisorRoleHandler implements RoleHandler {
  readonly key = PRINT_ADVISOR_ROLE_KEY;

  configure(tenant: TenantContext): TenantContext {
    return {
      ...tenant,
      roleKey: PRINT_ADVISOR_ROLE_KEY,
      systemPrompt: buildPrintAdvisorSystemPrompt(),
      aiProvider: PRINT_ADVISOR_PROVIDER,
      temperature: 0.2,
      maxTokens: 1_500,
    };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    await context.reply(await generatePrintAdvisorReply({
      tenant: context.tenant,
      ai: context.ai,
      businessData: context.businessData,
      history: context.history,
      log: context.log,
      messageText: context.message.text,
    }));
  }
}
