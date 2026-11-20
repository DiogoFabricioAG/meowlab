import { useCallback, useEffect, useState } from "react";

export type Quote = {
  description: string;
  quantity: string;
  unit: string;
  price: string;
  currency: "PEN" | "USD";
  source: string;
  requirementId?: string | null;
  inputPrice?: string | null;
  priceUnit?: string | null;
  conversionFactor?: string | null;
  observedAt?: string | null;
};

export type Work = {
  notes?: string;
  document?: string;
  quotes?: Quote[];
  documentEdits?: Record<string, string>;
  checklist?: string[];
};

export type Evidence = { sourceId: string; locator: string; quote: string };

export type Requirement = {
  id: string;
  name: string;
  description: string;
  kind: string;
  quantity: string | null;
  unit: string | null;
  evidence: Evidence[];
  partial: boolean;
};

export type TenderDocument = {
  id: string;
  title: string;
  body: string;
  stage: string;
  reason?: string;
  sourceTitle?: string;
  locator?: string;
  sourceUrl?: string;
  partial: boolean;
  evidence: Evidence[];
};

export type TenderData = {
  status: string;
  generation: string;
  requirements: Requirement[];
  checks: {
    id: string;
    text: string;
    title?: string;
    stage?: string;
    reason?: string;
    details?: string[];
    tableFormat?: string;
    evidence: Evidence[];
  }[];
  documents: TenderDocument[];
  missing: string[];
  sourceCount: number;
};

export type OpportunityAlert = {
  ocid?: string;
  code: string;
  description: string;
  displayTitle?: string | null;
  buyer: string;
  buyerRuc?: string | null;
  location?: string | null;
  amount: string;
  deadline: string;
  sourceUrl: string | null;
};

export type TenderOpportunity = {
  id: string;
  alert: OpportunityAlert;
  selection: string;
  hidden: boolean;
  version: number;
  work: Work;
  observedAt: string | null;
  items: {
    description: string;
    quantity: number | null;
    unit: string | null;
  }[];
  documents: { title: string; url: string }[];
  basesUploaded: boolean;
  knowledgeVersion?: string;
  uploadedBases: { id: string; title: string; url: string }[];
};

export type MarketReference = {
  url: string;
  title: string;
  price: string | null;
  currency: "PEN" | "USD" | null;
  unit: string | null;
  observedAt: string;
  status: string;
  quote?: string;
};

export type MarketAutomaticStatus =
  | "waiting"
  | "queued"
  | "running"
  | "retry"
  | "failed"
  | "complete"
  | "disabled";

export type MarketResponse = {
  references: Record<string, MarketReference[]>;
  automaticStatus?: MarketAutomaticStatus | string | null;
};

export class TenderApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function tenderBase(companyId: string): string {
  return `/api/companies/${encodeURIComponent(companyId)}/tender`;
}

/** Rewrite legacy /api/workspace/* paths returned by RADAR to the portal's authenticated tender proxy. */
export function portalTenderUrl(companyId: string, rawUrl: string | null | undefined): string | null {
  const value = rawUrl?.trim();
  if (!value) return null;
  if (value.startsWith("/api/workspace/")) {
    return `${tenderBase(companyId)}/${value.slice("/api/workspace/".length)}`;
  }
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function tenderApi<T>(
  companyId: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = "GET", body, signal } = options;
  const response = await fetch(`${tenderBase(companyId)}${path}`, {
    method,
    credentials: "same-origin",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail = typeof data.detail === "string"
      ? data.detail
      : typeof data.error === "string"
        ? data.error
        : "No pudimos completar la consulta. Vuelve a intentarlo.";
    throw new TenderApiError(detail, response.status);
  }
  return data as T;
}

export function useTenderWork(companyId: string, opportunityId: string) {
  const [data, setData] = useState<TenderData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cycle, setCycle] = useState(0);

  const refresh = useCallback(async () => {
    setCycle((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rounds = 0;
    const load = async () => {
      try {
        const result = await tenderApi<TenderData>(
          companyId,
          `/opportunities/${encodeURIComponent(opportunityId)}/case-work`,
          { method: "GET", signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setData(result);
        setError("");
        if (["queued", "running"].includes(result.status) && rounds++ < 30) {
          timer = setTimeout(() => void load(), 4000);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("No pudimos leer el expediente. Vuelve a consultar.");
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [companyId, opportunityId, cycle]);

  async function analyze() {
    setBusy(true);
    setError("");
    try {
      await tenderApi(companyId, `/opportunities/${encodeURIComponent(opportunityId)}/preparation`, {
        method: "POST",
      });
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error && !/fetch|network/i.test(e.message)
          ? e.message
          : "No pudimos iniciar la lectura de bases.",
      );
    } finally {
      setBusy(false);
    }
  }

  return { data, error, busy, refresh, analyze };
}

// Arithmetic over published measures; unknown or conflicting presentations stay unknown.
const UNITS: Record<string, [string, number]> = {
  kg: ["mass", 1],
  kilogramo: ["mass", 1],
  kilogramos: ["mass", 1],
  kilo: ["mass", 1],
  kilos: ["mass", 1],
  g: ["mass", 0.001],
  gramo: ["mass", 0.001],
  gramos: ["mass", 0.001],
  t: ["mass", 1000],
  tonelada: ["mass", 1000],
  toneladas: ["mass", 1000],
  l: ["volume", 1],
  litro: ["volume", 1],
  litros: ["volume", 1],
  ml: ["volume", 0.001],
  m: ["length", 1],
  metro: ["length", 1],
  metros: ["length", 1],
  cm: ["length", 0.01],
  mm: ["length", 0.001],
  m2: ["area", 1],
  m3: ["cubic", 1],
  unidad: ["count", 1],
  unidades: ["count", 1],
  und: ["count", 1],
  unid: ["count", 1],
  pieza: ["count", 1],
  piezas: ["count", 1],
  par: ["count", 2],
  pares: ["count", 2],
  docena: ["count", 12],
};

const cleanUnit = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[²]/g, "2")
    .replace(/[³]/g, "3")
    .trim()
    .replace(/\.$/, "");

function measure(text: string) {
  const found = [
    ...cleanUnit(text).matchAll(
      /(?:^|[^\w.,])(\d+(?:[.,]\d{1,2})?)\s*(kilogramos?|kilos?|kg|gramos?|g|toneladas?|t|litros?|ml|l|metros?|cm|mm|m2|m3|m|unidades|unidad|und|unid|piezas?|pares|par|docena)(?!\w)/g,
    ),
  ].map((m) => {
    const u = UNITS[m[2]!];
    return { dimension: u![0], amount: Number(m[1]!.replace(",", ".")) * u![1] };
  });
  const unique = [...new Map(found.map((v) => [`${v.dimension}:${v.amount}`, v])).values()];
  return unique.length === 1 ? unique[0]! : null;
}

export function referenceFactor(
  requiredUnit: string,
  requiredDescription: string,
  reference: { unit: string | null; title: string; quote?: string },
): number | null {
  const base = cleanUnit(requiredUnit);
  const offered = cleanUnit(reference.unit ?? "");
  if (UNITS[base]?.[0] === "count" && /(?:\bc\/u\b|\bpor (?:unidad|pieza)\b)/i.test(reference.quote ?? "") && !offered) {
    return 1 / UNITS[base]![1];
  }
  const priceMeasure = UNITS[offered]
    ? { dimension: UNITS[offered]![0], amount: UNITS[offered]![1] }
    : (measure(reference.unit ?? "") ?? measure(`${reference.title} ${reference.quote ?? ""}`));
  const required = UNITS[base] ? { dimension: UNITS[base]![0], amount: UNITS[base]![1] } : null;
  if (required && priceMeasure && required.dimension === priceMeasure.dimension) {
    return priceMeasure.amount / required.amount;
  }
  if (base && base === offered) {
    const requestedPackage = measure(requiredDescription);
    if (
      requestedPackage &&
      priceMeasure &&
      (requestedPackage.dimension !== priceMeasure.dimension || requestedPackage.amount !== priceMeasure.amount)
    ) {
      return null;
    }
    return 1;
  }
  return null;
}
