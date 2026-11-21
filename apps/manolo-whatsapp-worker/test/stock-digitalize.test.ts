import { describe, expect, it, vi } from "vitest";
import { parseStockSpreadsheet, SpreadsheetError } from "../src/node/stock/spreadsheet";
import { StockService, type StockPool } from "../src/node/stock/stock-service";
import type { BridgeRequestIdentity, BridgeRequestStore } from "../src/node/bridge/request-store";

function memoryRequestStore(): BridgeRequestStore {
  const map = new Map<string, string>();
  return {
    async claim(id: BridgeRequestIdentity) {
      const done = map.get(id.requestId);
      return done ? { status: "completed", replyText: done } : { status: "claimed" };
    },
    async complete(id: BridgeRequestIdentity, replyText: string) {
      map.set(id.requestId, replyText);
    },
    async fail() {},
  };
}

describe("parseStockSpreadsheet", () => {
  it("interprets varied Spanish headers, semicolon CSV and Peruvian prices", async () => {
    const csv = "Descripción;Cant.;P. unit.;Stock mínimo;Tipo\nPolo blanco M;25;S/ 14.50;5;Producto\nHilo cono;10;8,50;2;Insumo\n";
    const result = await parseStockSpreadsheet({
      filename: "stock.csv",
      mimeType: "text/csv",
      dataBase64: Buffer.from(csv, "utf8").toString("base64"),
    });
    expect(result).toEqual({
      status: "parsed",
      skippedRows: 0,
      lines: [
        { name: "Polo blanco M", quantity: 25, unitCostCents: 1450, minQty: 5, kind: "product" },
        { name: "Hilo cono", quantity: 10, unitCostCents: 850, minQty: 2, kind: "supply" },
      ],
    });
  });

  it("asks when required columns are not recognized", async () => {
    const csv = "Columna A,Columna B\nPolo,10\n";
    const result = await parseStockSpreadsheet({
      filename: "raro.csv",
      mimeType: "text/csv",
      dataBase64: Buffer.from(csv, "utf8").toString("base64"),
    });
    expect(result).toEqual({
      status: "unknown_columns",
      headers: ["Columna A", "Columna B"],
      sampleRows: [["Polo", "10"]],
    });
  });

  it("rejects files over 2 MB or over 500 rows", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, 65).toString("base64");
    await expect(parseStockSpreadsheet({ filename: "big.csv", dataBase64: big }))
      .rejects.toMatchObject({ code: "file_too_large" } satisfies Partial<SpreadsheetError>);

    const rows = ["Producto,Cantidad", ...Array.from({ length: 501 }, (_, i) => `Item ${i},1`)].join("\n");
    await expect(parseStockSpreadsheet({ filename: "many.csv", mimeType: "text/csv", dataBase64: Buffer.from(rows).toString("base64") }))
      .rejects.toMatchObject({ code: "too_many_rows" } satisfies Partial<SpreadsheetError>);
  });
});

describe("StockService supplier invoice idempotency and tenant isolation", () => {
  function fakePool() {
    const invoices = new Set<string>();
    const moves: Array<{ tenant: string; doc: string | null; supplier: string | null }> = [];
    const items = new Map<string, { id: string; tenant_id: string; name: string; on_hand: number; avg_cost_cents: number | null; min_qty: number | null }>();

    const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM whatsapp.contacts")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("FROM whatsapp.tenant_members")) {
        return { rows: [{ id: "org_a", name: "Empresa A" }] };
      }
      if (sql.includes("FROM whatsapp.portal_company_members")) return { rows: [{ claimed: false, owner: true }] };
      if (sql.includes("SELECT allow_negative FROM stock.settings")) return { rows: [{ allow_negative: true }] };
      if (sql.includes("INSERT INTO stock.supplier_invoices")) {
        const key = `${values[0]}:${values[1]}:${values[2]}`;
        if (invoices.has(key)) return { rows: [] };
        invoices.add(key);
        return { rows: [{ document_number: values[2] }] };
      }
      if (sql.includes("FROM stock.items AS item")) {
        const key = `${values[0]}:${String(values[1]).toLowerCase()}`;
        const found = items.get(key);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes("INSERT INTO stock.items")) {
        const row = { id: String(values[0]), tenant_id: String(values[1]), name: String(values[3]), on_hand: 0, avg_cost_cents: null, min_qty: null };
        items.set(`${values[1]}:${String(values[3]).toLowerCase()}`, row);
        return { rows: [row] };
      }
      if (sql.includes("UPDATE stock.items SET on_hand")) {
        for (const item of items.values()) {
          if (item.id === values[0]) {
            item.on_hand = Number(values[1]);
            item.avg_cost_cents = values[2] === null ? null : Number(values[2]);
          }
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO stock.moves")) {
        moves.push({ tenant: String(values[1]), doc: values[7] as string | null, supplier: values[10] as string | null });
        return { rows: [] };
      }
      return { rows: [] };
    });

    const pool: StockPool = {
      query,
      async connect() {
        return { query, release() {} };
      },
    };
    return { pool, moves };
  }

  it("registers a supplier invoice once and rejects duplicates", async () => {
    const { pool, moves } = fakePool();
    const service = new StockService(pool, memoryRequestStore(), vi.fn());

    const payload = {
      kind: "in",
      lines: [{ name: "Tela jersey", quantity: 20, unitCostCents: 18000 }],
      supplier: { name: "Textiles Lima S.A.C.", ruc: "20512345678" },
      documentNumber: "F002-881",
    };

    const first = await service.process(
      { channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a", operation: "move", payload },
      "req-1",
      "hash-1",
    );
    expect(first.status).toBe("completed");
    if (first.status === "completed") expect(first.response.ok).toBe(true);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({ tenant: "org_a", doc: "F002-881", supplier: "Textiles Lima S.A.C." });

    const second = await service.process(
      { channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a", operation: "move", payload },
      "req-2",
      "hash-2",
    );
    expect(second.status).toBe("completed");
    if (second.status === "completed") {
      expect(second.response.ok).toBe(false);
      expect(second.response.error?.code).toBe("duplicate_supplier_invoice");
    }
    expect(moves).toHaveLength(1);
  });

  it("blocks access to another tenant's company", async () => {
    const { pool } = fakePool();
    const service = new StockService(pool, memoryRequestStore(), vi.fn());
    const res = await service.process(
      { channel_tenant_id: "manolo", contact_id: 1, company_id: "org_other", operation: "items", payload: {} },
      "req-3",
      "hash-3",
    );
    expect(res.status).toBe("completed");
    if (res.status === "completed") {
      expect(res.response.ok).toBe(false);
      expect(res.response.error?.code).toBe("forbidden");
    }
  });
});
