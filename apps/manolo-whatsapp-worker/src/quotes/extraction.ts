import type { QuoteDraft, QuoteExtraction } from "./types";

export const MAX_QUOTE_ITEMS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanItemDescription(value: string): string {
  return value
    .trim()
    .replace(/^[,:;\-\s]+|[,:;\-\s]+$/gu, "")
    .replace(/^(?:el|la|un|una)\s+/iu, "")
    .replace(/^(?:y\s+)?producto\s+(?:de\s+|del\s+)?/iu, "")
    .replace(/\bde\s+(?=\d)/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function isGenericItemDescription(value: string): boolean {
  const normalized = cleanItemDescription(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+(?:[.,]\d+)?/gu, "")
    .replace(/[^a-z]+/gu, " ")
    .trim();

  return /^(?:unidad(?:es)?|ud(?:s)?|producto(?:s)?|item(?:s)?|cantidad(?:es)?)$/u.test(
    normalized,
  );
}

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number.parseFloat(value.replace(",", "."));
  }
  return Number.NaN;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
  maxLength: number,
): string {
  for (const key of keys) {
    const value = stringValue(record[key], maxLength);
    if (value) {
      return value;
    }
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return Number.NaN;
}

export function normalizeQuoteExtraction(value: unknown): QuoteExtraction | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawCustomer = isRecord(value.customer)
    ? value.customer
    : isRecord(value.cliente)
      ? value.cliente
      : isRecord(value.client)
        ? value.client
        : {};
  const rawItems = [
    value.items,
    value.products,
    value.productos,
    value.services,
    value.servicios,
    value.lineItems,
    value.detalles,
  ].find((candidate): candidate is unknown[] => Array.isArray(candidate))
    ?? (isRecord(value.item)
      ? [value.item]
      : isRecord(value.product)
        ? [value.product]
        : []);
  const items = rawItems
    .map((rawItem) => {
      if (!isRecord(rawItem)) {
        return null;
      }
      const description = firstString(
        rawItem,
        [
          "description",
          "descripcion",
          "product",
          "producto",
          "name",
          "nombre",
          "service",
          "servicio",
          "item",
          "detalle",
        ],
        300,
      );
      const quantity = firstNumber(
        rawItem,
        ["quantity", "cantidad", "qty", "units", "unidades"],
      );
      const unitPrice = firstNumber(
        rawItem,
        [
          "unitPrice",
          "unit_price",
          "precioUnitario",
          "precio_unitario",
          "price",
          "precio",
          "valorUnitario",
          "valor_unitario",
        ],
      );
      if (
        description.length === 0 ||
        isGenericItemDescription(description) ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        return null;
      }
      return {
        description,
        quantity: Math.round(quantity * 100) / 100,
        unitPrice: Math.round(unitPrice * 100) / 100,
      };
    })
    .filter((item): item is QuoteExtraction["items"][number] => item !== null)
    .slice(0, MAX_QUOTE_ITEMS);

  return {
    customer: {
      name:
        firstString(
          rawCustomer,
          ["name", "nombre", "customerName", "nombreCliente", "fullName"],
          160,
        ) ||
        firstString(
          value,
          ["customerName", "nombreCliente", "clienteNombre", "nombre"],
          160,
        ) ||
        (typeof value.cliente === "string"
          ? stringValue(value.cliente, 160)
          : ""),
      taxId:
        firstString(
          rawCustomer,
          ["taxId", "tax_id", "ruc", "dni", "documento", "documentId"],
          40,
        ) ||
        firstString(value, ["taxId", "tax_id", "ruc", "dni", "documento"], 40),
      phone:
        firstString(
          rawCustomer,
          ["phone", "phoneNumber", "telefono", "celular", "mobile"],
          40,
        ) ||
        firstString(value, ["phone", "phoneNumber", "telefono", "celular"], 40),
    },
    items,
    assistantMessage: firstString(
      value,
      ["assistantMessage", "mensaje", "message", "respuesta"],
      500,
    ),
    readyToConfirm: value.readyToConfirm === true,
  };
}

function normalizedItemTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 4)
    .map((token) =>
      token.endsWith("es") && token.length > 5
        ? token.slice(0, -2)
        : token.endsWith("s") && token.length > 4
          ? token.slice(0, -1)
          : token,
    );
}

function itemsReferToSameProduct(left: string, right: string): boolean {
  const leftText = normalizedItemTokens(left).join(" ");
  const rightText = normalizedItemTokens(right).join(" ");
  if (!leftText || !rightText) {
    return false;
  }

  if (
    leftText === rightText ||
    leftText.includes(rightText) ||
    rightText.includes(leftText)
  ) {
    return true;
  }

  const leftTokens = leftText.split(" ");
  const rightTokens = new Set(rightText.split(" "));
  return leftTokens.some((token) => rightTokens.has(token));
}

function itemDescriptionsAreEquivalent(left: string, right: string): boolean {
  return itemDescriptionTokens(left).join(" ") === itemDescriptionTokens(right).join(" ");
}

function itemDescriptionTokens(value: string): string[] {
  return cleanItemDescription(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => !["de", "del", "la", "el", "y", "e"].includes(token))
    .map((token) =>
      token.endsWith("es") && token.length > 5
        ? token.slice(0, -2)
        : token.endsWith("s") && token.length > 4
          ? token.slice(0, -1)
          : token,
    );
}

function mergeItemLists(
  modelItems: QuoteExtraction["items"],
  explicitItems: QuoteExtraction["items"],
): QuoteExtraction["items"] {
  const merged = [...modelItems];
  for (const explicitItem of explicitItems) {
    const existingIndex = merged.findIndex((modelItem) =>
      itemsReferToSameProduct(modelItem.description, explicitItem.description),
    );
    if (existingIndex >= 0) {
      const existingItem = merged[existingIndex];
      const equivalentDescriptions = itemDescriptionsAreEquivalent(
        existingItem.description,
        explicitItem.description,
      );
      merged[existingIndex] = {
        ...explicitItem,
        description: equivalentDescriptions && itemDescriptionTokens(existingItem.description).length > 1
          ? existingItem.description
          : explicitItem.description,
      };
    } else {
      merged.push(explicitItem);
    }
  }
  return merged.slice(0, MAX_QUOTE_ITEMS);
}

function parseItem(
  description: unknown,
  quantity: unknown,
  unitPrice: unknown,
): QuoteExtraction["items"][number] | null {
  const normalizedDescription = cleanItemDescription(stringValue(description, 300));
  const normalizedQuantity = numberValue(quantity);
  const normalizedUnitPrice = numberValue(unitPrice);
  if (
    normalizedDescription.length === 0 ||
    isGenericItemDescription(normalizedDescription) ||
    !Number.isFinite(normalizedQuantity) ||
    normalizedQuantity <= 0 ||
    !Number.isFinite(normalizedUnitPrice) ||
    normalizedUnitPrice < 0
  ) {
    return null;
  }
  return {
    description: normalizedDescription,
    quantity: Math.round(normalizedQuantity * 100) / 100,
    unitPrice: Math.round(normalizedUnitPrice * 100) / 100,
  };
}

export function extractQuoteFactsFromText(messageText: string): QuoteExtraction {
  const customerName =
    messageText.match(/(?:cliente|clienta)\s*[:\-]?\s*([^\n,;]+)/iu)?.[1]?.trim() ?? "";
  const taxId =
    messageText.match(/\b(?:dni|ruc)\s*[:\-]?\s*([0-9]{8,11})\b/iu)?.[1] ?? "";
  const phone =
    messageText
      .match(/\b(?:tel[eé]fono|te+lefono|phone|cel(?:ular)?)\s*[:\-]?\s*([+]?[0-9][0-9\s-]{6,18})/iu)?.[1]
      ?.replace(/[\s-]/g, "") ?? "";

  const productMatch = messageText.match(
    /\bproducto\s+(?:de\s+|del\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:ud(?:s)?|unidades?|x)\s*(?:c\/u)?\s*[:\-]?\s*(?:s\/?\.?\s*)?(\d+(?:[.,]\d+)?)/iu,
  );
  const productBeforeQuantityMatch = messageText.match(
    /(?:^|[\n;])\s*(?:y\s+)?([^\n;]+?)\s*,?\s*(\d+(?:[.,]\d+)?)\s*(?:ud(?:s)?|unidades?)\s*(?:c\/u|cada\s+(?:una|uno))?\s*[:\-]?\s*(?:a\s+)?(?:s\/?\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:soles?|s\/?\.?)?/iu,
  );
  const quantityBeforeDescriptionMatches = [
    ...messageText.matchAll(
      /\b(\d+(?:[.,]\d+)?)\s+([^,;.\n]+?)\s+(?:a|por|c\/u)\s*(?:s\/?\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:soles?|s\/?\.?)?/giu
    ),
  ];
  const productReferenceMatch = messageText.match(
    /\b(?:el|la)\s+de\s+(?:el|la)\s+(.+?)(?=\s*,?\s*(?:compr[eé]|adquir[ií]|llev[eé]|compramos|adquirimos)(?=\s|$))/iu,
  );
  const purchaseMatch = messageText.match(
    /\b(?:compr[eé]|adquir[ií]|llev[eé]|compramos|adquirimos)\s+(\d+(?:[.,]\d+)?)\s+([^,.;!?\n]+?)(?=\s+(?:a|por|y|e|pero)\b|\s*$)/iu,
  );
  const moneyMatches = [
    ...messageText.matchAll(
      /(?<!\d)(\d+(?:[.,]\d+)?)\s*(?:soles?|s\/?\.?)(?!\w)/giu,
    ),
  ];
  const explicitMoney = moneyMatches.length > 0
    ? numberValue(moneyMatches[moneyMatches.length - 1]?.[1])
    : Number.NaN;
  const explicitUnitPrice = messageText.match(
    /\b(?:a|por)\s+(?:s\/?\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:soles?|s\/?\.?)\b/iu,
  );

  const items: QuoteExtraction["items"] = [];
  const addItem = (item: QuoteExtraction["items"][number] | null): void => {
    if (item) {
      items.push(item);
    }
  };

  addItem(
    productMatch
      ? parseItem(productMatch[1], productMatch[2], productMatch[3])
      : null,
  );

  addItem(
    productBeforeQuantityMatch
      ? parseItem(
          productBeforeQuantityMatch[1],
          productBeforeQuantityMatch[2],
          productBeforeQuantityMatch[3],
        )
      : null,
  );

  for (const match of quantityBeforeDescriptionMatches) {
    addItem(parseItem(match[2], match[1], match[3]));
  }

  const purchaseDescription = productReferenceMatch?.[1] ?? purchaseMatch?.[2];
  addItem(
    purchaseMatch
      ? parseItem(
          purchaseDescription,
          purchaseMatch[1],
          Number.isFinite(numberValue(explicitUnitPrice?.[1]))
            ? numberValue(explicitUnitPrice?.[1])
            : Number.isFinite(explicitMoney) && numberValue(purchaseMatch[1]) > 0
              ? explicitMoney / numberValue(purchaseMatch[1])
              : Number.NaN,
        )
      : null,
  );

  return {
    customer: { name: customerName, taxId, phone },
    items: mergeItemLists([], items),
    assistantMessage: "",
    readyToConfirm: false,
  };
}

export function mergeQuoteExtractions(
  modelExtraction: QuoteExtraction | null,
  fallbackExtraction: QuoteExtraction,
): QuoteExtraction | null {
  if (!modelExtraction) {
    return fallbackExtraction.customer.name || fallbackExtraction.items.length > 0
      ? fallbackExtraction
      : null;
  }

  return {
    customer: {
      name: modelExtraction.customer.name || fallbackExtraction.customer.name,
      taxId: modelExtraction.customer.taxId || fallbackExtraction.customer.taxId,
      phone: modelExtraction.customer.phone || fallbackExtraction.customer.phone,
    },
    items: mergeItemLists(modelExtraction.items, fallbackExtraction.items),
    assistantMessage: modelExtraction.assistantMessage,
    readyToConfirm: modelExtraction.readyToConfirm,
  };
}

export function applyQuoteExtraction(
  draft: QuoteDraft,
  extraction: QuoteExtraction,
): QuoteDraft {
  const items = extraction.items.length > 0
    ? mergeItemLists(draft.items, extraction.items).map((item, index) => ({
        ...item,
        position: index + 1,
      }))
    : draft.items;

  return {
    ...draft,
    customerName: extraction.customer.name || draft.customerName,
    customerTaxId: extraction.customer.taxId || draft.customerTaxId,
    customerPhone: extraction.customer.phone || draft.customerPhone,
    items,
    importeLetras: "",
  };
}
