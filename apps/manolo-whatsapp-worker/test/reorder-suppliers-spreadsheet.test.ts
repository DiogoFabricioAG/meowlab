import { describe, expect, it, vi } from "vitest";
import { parseSuppliersSpreadsheet } from "../src/node/reorder/spreadsheet";
import { ReorderService, type ReorderPool } from "../src/node/reorder/reorder-service";
import type { BridgeRequestIdentity, BridgeRequestStore } from "../src/node/bridge/request-store";
import { isReorderBridgeRequest } from "../src/reorder/bridge-contracts";
import type { ReorderClient, ReorderOverview } from "../src/reorder/client";
import { REORDER_ROLE_KEY, ReorderRoleHandler } from "../src/roles/reorder-role";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a minimal valid uncompressed (STORE) .xlsx zip buffer for read-excel-file/node. */
function buildXlsxBuffer(rows: Array<Array<string | number>>): Buffer {
  const xmlEscape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colName = (idx: number) => String.fromCharCode(65 + idx);
  const sheetRows = rows
    .map((row, rIdx) => {
      const cells = row
        .map((val, cIdx) => {
          const ref = `${colName(cIdx)}${rIdx + 1}`;
          if (typeof val === "number") return `<c r="${ref}"><v>${val}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(val))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rIdx + 1}">${cells}</row>`;
    })
    .join("");

  const files: Array<{ name: string; content: string }> = [
    {
      name: "[Content_Types].xml",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Proveedores" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ];

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const dataBuf = Buffer.from(file.content, "utf8");
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    localParts.push(local, dataBuf);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);

    offset += local.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

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

function memoryState(): RoleStateRepository {
  const store = new Map<string, string>();
  const key = (t: string, c: number, r: string) => `${t}:${c}:${r}`;
  return {
    async get(t, c, r) { return store.get(key(t, c, r)) ?? null; },
    async set(t, c, r, json) { store.set(key(t, c, r), json); return true; },
    async clear(t, c, r) { return store.delete(key(t, c, r)); },
  };
}

const tenant: TenantContext = {
  tenantId: "manolo", phoneNumberId: "pn", roleKey: REORDER_ROLE_KEY, systemPrompt: "", aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b", temperature: 0, maxTokens: 900,
};

const EMPTY_OVERVIEW: ReorderOverview = {
  owner: true, companyName: "CREACIONES J&D", created: [], settings: { monthlyBudgetCents: null, followupHours: 24, escalateHours: 48 },
  proposals: [], open: [], notices: [], needsMax: [], needsSupplier: [], monthSpentCents: 0,
};

describe("parseSuppliersSpreadsheet", () => {
  it("parses a valid .xlsx file with suppliers, normalized phones, products and delivery days", async () => {
    const xlsx = buildXlsxBuffer([
      ["Proveedor", "Teléfono", "Productos", "Días de entrega"],
      ["Textiles Lima", 987654321, "Polo blanco M, Polo negro L", "3 días"],
      ["Cerámicas Perú", "+51 912 345 678", "Taza blanca", "Lunes y jueves"],
    ]);
    const knownItems = new Map([
      ["polo blanco m", "Polo blanco M"],
      ["polo negro l", "Polo negro L"],
      ["taza blanca", "Taza blanca"],
    ]);
    const result = await parseSuppliersSpreadsheet({
      filename: "proveedores.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dataBase64: xlsx.toString("base64"),
      knownItems,
    });
    expect(result).toEqual({
      status: "parsed",
      doubtful: [],
      suppliers: [
        { name: "Textiles Lima", phone: "51987654321", deliveryDays: "3 días", items: ["Polo blanco M", "Polo negro L"] },
        { name: "Cerámicas Perú", phone: "51912345678", deliveryDays: "Lunes y jueves", items: ["Taza blanca"] },
      ],
    });
  });

  it("parses a semicolon CSV and deduplicates repeated phone numbers within the same file", async () => {
    const csv = "\uFEFFNombre;WhatsApp;Producto;Entrega\nTextiles Lima;987654321;Polo blanco M;2 días\nTextiles Lima SAC;+51 987 654 321;Polo negro L;2 días\n";
    const knownItems = new Map([
      ["polo blanco m", "Polo blanco M"],
      ["polo negro l", "Polo negro L"],
    ]);
    const result = await parseSuppliersSpreadsheet({
      filename: "proveedores.csv",
      mimeType: "text/csv",
      dataBase64: Buffer.from(csv, "utf8").toString("base64"),
      knownItems,
    });
    expect(result).toEqual({
      status: "parsed",
      doubtful: [],
      suppliers: [
        { name: "Textiles Lima", phone: "51987654321", deliveryDays: "2 días", items: ["Polo blanco M", "Polo negro L"] },
      ],
    });
  });

  it("lists doubtful rows (invalid phone, unknown inventory product) separately without including them", async () => {
    const csv = [
      "Nombre,Teléfono,Productos,Días de entrega",
      "Textiles Lima,987654321,\"Polo blanco M, Producto Fantasma\",3 días",
      "Proveedor Malo,12345,Polo blanco M,2 días",
      ",999888777,Polo blanco M,1 día",
    ].join("\n");
    const knownItems = new Map([["polo blanco m", "Polo blanco M"]]);
    const result = await parseSuppliersSpreadsheet({
      filename: "dudosos.csv",
      mimeType: "text/csv",
      dataBase64: Buffer.from(csv, "utf8").toString("base64"),
      knownItems,
    });
    expect(result).toEqual({
      status: "parsed",
      suppliers: [
        { name: "Textiles Lima", phone: "51987654321", deliveryDays: "3 días", items: ["Polo blanco M"] },
      ],
      doubtful: [
        "Fila 2 (Textiles Lima): producto «Producto Fantasma» no está en el inventario.",
        "Fila 3 (Proveedor Malo): teléfono inválido «12345».",
        "Fila 4: falta el nombre del proveedor.",
      ],
    });
  });
});

describe("ReorderService supplier spreadsheet import & tenant isolation", () => {
  function fakePool() {
    const stockItems = new Map<string, { id: string; tenant_id: string; name: string; active: boolean }>([
      ["org_a:polo blanco m", { id: "item_a1", tenant_id: "org_a", name: "Polo blanco M", active: true }],
      ["org_a:polo negro l", { id: "item_a2", tenant_id: "org_a", name: "Polo negro L", active: true }],
      ["org_b:polo blanco m", { id: "item_b1", tenant_id: "org_b", name: "Polo blanco M", active: true }],
      ["org_b:taza roja", { id: "item_b2", tenant_id: "org_b", name: "Taza roja", active: true }],
    ]);
    const suppliers = new Map<string, { id: string; tenant_id: string; name: string; phone: string | null; ruc: string | null; active: boolean }>();
    const rules = new Map<string, { item_id: string; tenant_id: string; supplier_id: string }>();

    const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM whatsapp.contacts")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("FROM whatsapp.tenant_members")) {
        const contactId = Number(values[0]);
        if (contactId === 1) return { rows: [{ id: "org_a", name: "Empresa A" }] };
        return { rows: [{ id: "org_b", name: "Empresa B" }] };
      }
      if (sql.includes("FROM whatsapp.portal_company_members")) return { rows: [{ claimed: false, owner: true }] };
      if (sql.includes("SELECT name FROM stock.items WHERE tenant_id = $1 AND active")) {
        const tid = String(values[0]);
        return { rows: [...stockItems.values()].filter((i) => i.tenant_id === tid && i.active).map((i) => ({ name: i.name })) };
      }
      if (sql.includes("FROM stock.items AS item")) {
        const key = `${values[0]}:${String(values[1]).toLowerCase()}`;
        const item = stockItems.get(key);
        return { rows: item ? [{ id: item.id, name: item.name }] : [] };
      }
      if (sql.includes("SELECT id, name FROM purchasing.suppliers WHERE tenant_id = $1 AND phone = $2")) {
        const found = [...suppliers.values()].find((s) => s.tenant_id === values[0] && s.phone === values[1]);
        return { rows: found ? [{ id: found.id, name: found.name }] : [] };
      }
      if (sql.includes("SELECT id FROM purchasing.suppliers") && sql.includes("id <> $3")) {
        const found = [...suppliers.values()].find((s) => s.tenant_id === values[0] && s.name.toLowerCase() === String(values[1]).toLowerCase() && s.id !== values[2]);
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (sql.includes("SELECT id FROM purchasing.suppliers") && sql.includes("lower(name) = lower($2)")) {
        const found = [...suppliers.values()].find((s) => s.tenant_id === values[0] && ((values[2] && s.ruc === values[2]) || s.name.toLowerCase() === String(values[1]).toLowerCase()));
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (sql.includes("SELECT id, name FROM purchasing.suppliers") && sql.includes("lower(name) = lower($2)")) {
        const found = [...suppliers.values()].find((s) => s.tenant_id === values[0] && ((values[2] && s.ruc === values[2]) || s.name.toLowerCase() === String(values[1]).toLowerCase()));
        return { rows: found ? [{ id: found.id, name: found.name }] : [] };
      }
      if (sql.includes("UPDATE purchasing.suppliers") && sql.includes("SET name = $2")) {
        const s = suppliers.get(String(values[0]));
        if (s) {
          s.name = String(values[1]);
          if (!s.ruc && values[2]) s.ruc = String(values[2]);
          s.active = true;
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO purchasing.suppliers")) {
        const id = String(values[0]);
        suppliers.set(id, {
          id,
          tenant_id: String(values[1]),
          name: String(values[2]),
          ruc: values[3] ? String(values[3]) : null,
          phone: values[4] ? String(values[4]) : null,
          active: true,
        });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO purchasing.item_rules")) {
        rules.set(String(values[0]), { item_id: String(values[0]), tenant_id: String(values[1]), supplier_id: String(values[2]) });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO purchasing.audit_log")) return { rows: [] };
      return { rows: [] };
    });

    const pool: ReorderPool = {
      query,
      async connect() {
        return { query, release() {} };
      },
    };
    return { pool, suppliers, rules };
  }

  it("updates without duplicating when the same file is imported twice", async () => {
    const { pool, suppliers, rules } = fakePool();
    const service = new ReorderService(pool, memoryRequestStore(), vi.fn());
    const rows = [
      { name: "Textiles Lima", phone: "51987654321", deliveryDays: "3 días", items: ["Polo blanco M", "Polo negro L"] },
    ];

    const first = await service.process({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "import_suppliers",
      company_id: "org_a",
      payload: { suppliers: rows },
    }, "req-1", "hash-1");
    expect(first.status).toBe("completed");
    if (first.status === "completed") {
      expect(first.response.ok).toBe(true);
      expect(first.response.data).toEqual({ created: 1, updated: 0, linked: 2, notFound: [] });
    }

    const second = await service.process({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "import_suppliers",
      company_id: "org_a",
      payload: { suppliers: [{ ...rows[0], name: "Textiles Lima SAC" }] },
    }, "req-2", "hash-2");
    expect(second.status).toBe("completed");
    if (second.status === "completed") {
      expect(second.response.ok).toBe(true);
      expect(second.response.data).toEqual({ created: 0, updated: 1, linked: 2, notFound: [] });
    }
    expect(suppliers.size).toBe(1);
    expect([...suppliers.values()][0].name).toBe("Textiles Lima SAC");
    expect(rules.size).toBe(2);
  });

  it("isolates spreadsheet parsing and supplier imports per company", async () => {
    const { pool, suppliers, rules } = fakePool();
    const service = new ReorderService(pool, memoryRequestStore(), vi.fn());

    // Company A uploads a CSV mentioning Taza roja (which belongs only to Company B)
    const csv = "Nombre,Teléfono,Productos\nTextiles Lima,987654321,\"Polo blanco M, Taza roja\"\n";
    const parsed = await service.process({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "parse_suppliers_spreadsheet",
      company_id: "org_a",
      payload: { filename: "prov.csv", mimeType: "text/csv", dataBase64: Buffer.from(csv, "utf8").toString("base64") },
    }, "req-parse-a", "hash-parse-a");
    expect(parsed.status).toBe("completed");
    if (parsed.status === "completed") {
      expect(parsed.response.data).toEqual({
        status: "parsed",
        suppliers: [{ name: "Textiles Lima", phone: "51987654321", items: ["Polo blanco M"] }],
        doubtful: ["Fila 2 (Textiles Lima): producto «Taza roja» no está en el inventario."],
      });
    }

    // Contact 1 (Company A) cannot import into Company B
    const crossTenant = await service.process({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "import_suppliers",
      company_id: "org_b",
      payload: { suppliers: [{ name: "Textiles Lima", phone: "51987654321", items: ["Polo blanco M"] }] },
    }, "req-cross", "hash-cross");
    expect(crossTenant.status).toBe("completed");
    if (crossTenant.status === "completed") {
      expect(crossTenant.response.ok).toBe(false);
      expect(crossTenant.response.error?.code).toBe("forbidden");
    }

    // Importing into Company A and Company B with the same phone keeps both companies separate
    await service.process({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "import_suppliers",
      company_id: "org_a",
      payload: { suppliers: [{ name: "Textiles A", phone: "51987654321", items: ["Polo blanco M"] }] },
    }, "req-imp-a", "hash-imp-a");
    await service.process({
      channel_tenant_id: "manolo",
      contact_id: 2,
      operation: "import_suppliers",
      company_id: "org_b",
      payload: { suppliers: [{ name: "Textiles B", phone: "51987654321", items: ["Taza roja"] }] },
    }, "req-imp-b", "hash-imp-b");

    expect(suppliers.size).toBe(2);
    expect(rules.get("item_a1")?.tenant_id).toBe("org_a");
    expect(rules.get("item_b2")?.tenant_id).toBe("org_b");
    expect(rules.has("item_b1")).toBe(false);
  });

  it("validates bridge requests for spreadsheet operations", () => {
    expect(isReorderBridgeRequest({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "parse_suppliers_spreadsheet",
      company_id: "org_a",
      payload: { filename: "prov.xlsx", dataBase64: "AQID" },
    })).toBe(true);
    expect(isReorderBridgeRequest({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "import_suppliers",
      company_id: "org_a",
      payload: { suppliers: [{ name: "Textiles Lima", phone: "51987654321", items: ["Polo blanco M"] }] },
    })).toBe(true);
    expect(isReorderBridgeRequest({
      channel_tenant_id: "manolo",
      contact_id: 1,
      operation: "import_suppliers",
      company_id: "org_a",
      payload: { suppliers: [{ name: "Textiles Lima", phone: "bad", items: [] }] },
    })).toBe(false);
  });
});

describe("ReorderRoleHandler spreadsheet confirmation & cancellation", () => {
  function makeContext(options: {
    text?: string;
    interactionId?: string | null;
    document?: { filename: string; mimeType: string; bytes: Uint8Array };
    state: RoleStateRepository;
  }) {
    const calls = {
      reply: vi.fn(async (_text: string) => undefined),
      sendButtons: vi.fn(async (_body: string, _buttons: Array<{ id: string; title: string }>) => ({ status: "sent" as const, metaMessageId: "b" })),
      sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "l" })),
      sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
    };
    const context = {
      message: {
        id: "wamid.1",
        interactionId: options.interactionId ?? null,
        phoneNumberId: "pn",
        to: "51911111111",
        inputType: options.document ? "document" : "text",
        text: options.text ?? options.interactionId ?? "",
      },
      document: options.document ?? null,
      tenant,
      persisted: { duplicate: false, conversationId: "c", contactId: 1 },
      env: {} as unknown as Env,
      ai: null,
      roleState: options.state,
      history: [],
      ...calls,
      generateAiReply: async () => null,
      generateAiReplyWithHistory: async () => null,
      fallbackReply: "",
      log: vi.fn(),
    } as unknown as RoleHandlerContext;
    return { context, calls };
  }

  it("asks for confirmation before saving and saves only on «sí»", async () => {
    const state = memoryState();
    const parseSuppliersSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: "parsed" as const,
        suppliers: [
          { name: "Textiles Lima", phone: "51987654321", deliveryDays: "3 días", items: ["Polo blanco M", "Polo negro L"] },
        ],
        doubtful: ["Fila 3 (Proveedor X): teléfono inválido «123»."],
      },
    }));
    const importSuppliers = vi.fn(async () => ({
      ok: true as const,
      data: { created: 1, updated: 0, linked: 2, notFound: [] },
    }));
    const client = {
      companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_a", name: "Empresa A" }] })),
      overview: vi.fn(async () => ({ ok: true as const, data: EMPTY_OVERVIEW })),
      parseSuppliersSpreadsheet,
      importSuppliers,
    } as unknown as ReorderClient;

    const handler = new ReorderRoleHandler(() => client, () => null);
    const upload = makeContext({
      text: "/reorder",
      document: { filename: "proveedores.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: new Uint8Array([1, 2, 3]) },
      state,
    });
    await handler.handle(upload.context);

    expect(importSuppliers).not.toHaveBeenCalled();
    expect(upload.calls.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("1 proveedor, 2 productos asignados"),
      [
        { id: "reorder:suppliers:confirm", title: "Sí, guardar" },
        { id: "reorder:suppliers:cancel", title: "No, cancelar" },
      ],
    );
    expect(upload.calls.sendButtons.mock.calls[0][0]).toContain("Con dudas (no se guardarán):");

    const confirm = makeContext({ text: "sí", state });
    await handler.handle(confirm.context);
    expect(importSuppliers).toHaveBeenCalledTimes(1);
    expect(confirm.calls.reply).toHaveBeenCalledWith("Listo: 1 proveedor nuevo, 2 productos asignados.");
  });

  it("saves nothing when the owner replies «no»", async () => {
    const state = memoryState();
    const parseSuppliersSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: "parsed" as const,
        suppliers: [{ name: "Textiles Lima", phone: "51987654321", items: ["Polo blanco M"] }],
        doubtful: [],
      },
    }));
    const importSuppliers = vi.fn();
    const client = {
      companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_a", name: "Empresa A" }] })),
      overview: vi.fn(async () => ({ ok: true as const, data: EMPTY_OVERVIEW })),
      parseSuppliersSpreadsheet,
      importSuppliers,
    } as unknown as ReorderClient;

    const handler = new ReorderRoleHandler(() => client, () => null);
    await handler.handle(makeContext({
      text: "/reorder",
      document: { filename: "proveedores.csv", mimeType: "text/csv", bytes: new Uint8Array([1, 2, 3]) },
      state,
    }).context);

    const cancel = makeContext({ text: "no", state });
    await handler.handle(cancel.context);
    expect(importSuppliers).not.toHaveBeenCalled();
    expect(cancel.calls.reply).toHaveBeenCalledWith("Descartado. No guardé ningún proveedor. ¿Algo más? Escribe /salir para volver con Manolo.");
  });
});
