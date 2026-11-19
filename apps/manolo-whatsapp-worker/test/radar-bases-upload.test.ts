import { env } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vitest";
import { D1RadarContactService } from "../src/adapters/radar/d1-contact-service";
import { radarHttp } from "../src/radar/http";
import { radarVerifiedWebhook } from "../src/radar/webhook";
import { RadarRoleHandler } from "../src/roles/radar-role";
import type { RoleHandlerContext } from "../src/roles/contracts";
import { editorialWriter } from "./radar-editorial-fixture";

const phone = "1266091906580349";
const user = "51955555555";
const alert1 = {
  ocid: "ocds-dgv273-seacev3-1258591",
  code: "LP-ABR-3-2026-WARMI NAN-1",
  description: "ADQUISICION DE CHALECOS INSTITUCIONALES",
  buyer: "Programa Warmi Nan",
  amount: "Monto por confirmar",
  deadline: "2026-11-04T04:59:00.000Z",
  sourceUrl: "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/1258591/2",
};
const alert2 = {
  ocid: "ocds-dgv273-seacev3-1259999",
  code: "AS-SM-12-2026-MML-1",
  description: "SUMINISTRO DE CEMENTO PORTLAND TIPO I",
  buyer: "Municipalidad Metropolitana de Lima",
  amount: "PEN 120000.00",
  deadline: "2026-11-10T04:59:00.000Z",
  sourceUrl: "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/1259999/2",
};

let clock: number;
const apiEnv = () => ({
  ...env,
  VPS_BRIDGE_ENABLED: "false",
  META_ACCESS_TOKEN: "test-token",
  META_APP_SECRET: "test-secret",
  META_GRAPH_API_VERSION: "v25.0",
} as Env);

const call = (path: string, token = "", data?: unknown) =>
  radarHttp(
    new Request(`https://test/v1/projects/radar${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": crypto.randomUUID() },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    apiEnv(),
    () => clock,
    editorialWriter,
  );

const pdfBytes = (body = "1 0 obj <<>> endobj") => new TextEncoder().encode(`%PDF-1.7\n${body}`);
const docxBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

async function setupLinkedInstallation(recipient = user) {
  const response = await call("/installations", "", {});
  const registration = await response.json() as { token: string; message: string; installationId: string };
  await radarVerifiedWebhook(
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: phone },
                messages: [
                  {
                    id: crypto.randomUUID(),
                    from: recipient,
                    timestamp: String(clock / 1000),
                    type: "text",
                    text: { body: registration.message },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    apiEnv(),
    () => clock,
  );
  return registration;
}

function makeRoleContext(
  service: D1RadarContactService,
  overrides: Partial<RoleHandlerContext> & { message?: Partial<RoleHandlerContext["message"]> } = {},
): RoleHandlerContext {
  const baseMessage: RoleHandlerContext["message"] = {
    id: `wamid.${crypto.randomUUID()}`,
    interactionId: null,
    phoneNumberId: phone,
    text: "",
    to: user,
    inputType: "document",
    ...(overrides.message ?? {}),
  };
  return {
    tenant: {
      tenantId: "manolo",
      phoneNumberId: phone,
      roleKey: "radar",
      systemPrompt: "RADAR",
      aiProvider: "none",
      aiModel: "test",
      temperature: 0,
      maxTokens: 200,
    },
    persisted: { duplicate: false, conversationId: "c", contactId: 42 },
    env: apiEnv(),
    ai: null,
    businessData: null,
    quoteNumberAllocator: null,
    history: [],
    reply: vi.fn(async () => {}),
    sendDocument: vi.fn(),
    generateAiReply: vi.fn(async () => "should-not-run"),
    generateAiReplyWithHistory: vi.fn(),
    fallbackReply: "",
    log: vi.fn(),
    radar: service,
    ...overrides,
    message: baseMessage,
  } as unknown as RoleHandlerContext;
}

beforeEach(async () => {
  clock = Date.parse("2026-10-31T15:00:00Z");
  await env.DB.batch(
    [
      "radar_preparation_notices",
      "radar_bases_uploads",
      "radar_alert_context",
      "radar_deliveries",
      "radar_installations",
      "radar_windows",
      "radar_inbound",
      "radar_rate_limits",
      "whatsapp_numbers",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1")
    .bind(phone, user)
    .run();
  await env.DB.prepare("INSERT INTO whatsapp_numbers (id,tenant_id,phone_number_id,active) VALUES (1,'manolo',?,1)")
    .bind(phone)
    .run();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] })));
});

it("validates document presence and binary signatures before AI/fallback", async () => {
  const reg = await setupLinkedInstallation();
  await call("/alerts", reg.token, alert1);
  const service = new D1RadarContactService(env.DB, "manolo", phone, user, () => clock, undefined, env.ENTERPRISE_DOCUMENTS);
  const role = new RadarRoleHandler();

  const missingDoc = makeRoleContext(service, { document: null });
  await role.handle(missingDoc);
  expect(missingDoc.generateAiReply).not.toHaveBeenCalled();
  expect(missingDoc.reply).toHaveBeenCalledWith(expect.stringContaining("hasta 15 MB"));

  const fakePdf = makeRoleContext(service, {
    document: { bytes: new TextEncoder().encode("not-a-pdf"), mimeType: "application/pdf", filename: "bases.pdf" },
  });
  await role.handle(fakePdf);
  expect(fakePdf.reply).toHaveBeenCalledWith(expect.stringContaining("PDF ni un Word (.docx) válido"));

  const fakeDocx = makeRoleContext(service, {
    document: {
      bytes: new TextEncoder().encode("plain text"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "bases.docx",
    },
  });
  await role.handle(fakeDocx);
  expect(fakeDocx.reply).toHaveBeenCalledWith(expect.stringContaining("PDF ni un Word (.docx) válido"));

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM radar_bases_uploads").first<{ n: number }>();
  expect(count?.n).toBe(0);
});

it("stores valid PDF/DOCX in R2 + D1, deduplicates by meta_message_id, and handles delivery ambiguity", async () => {
  const reg = await setupLinkedInstallation();
  const service = new D1RadarContactService(env.DB, "manolo", phone, user, () => clock, undefined, env.ENTERPRISE_DOCUMENTS);
  const role = new RadarRoleHandler();

  // 0 deliveries -> asks to select/specify code
  const noDelivery = makeRoleContext(service, {
    document: { bytes: pdfBytes(), mimeType: "application/pdf", filename: "bases.pdf" },
  });
  await role.handle(noDelivery);
  expect(noDelivery.reply).toHaveBeenCalledWith(expect.stringContaining("Me interesa"));

  // 1 delivery -> stores automatically, deduplicates on meta_message_id
  await call("/alerts", reg.token, alert1);
  const msgId = `wamid.${crypto.randomUUID()}`;
  const validPdf = makeRoleContext(service, {
    message: { id: msgId, interactionId: null, phoneNumberId: phone, text: "", to: user, inputType: "document" },
    document: { bytes: pdfBytes(), mimeType: "application/pdf", filename: "bases_oficiales.pdf" },
  });
  await role.handle(validPdf);
  expect(validPdf.reply).toHaveBeenCalledWith(expect.stringContaining("bases_oficiales.pdf"));
  expect(validPdf.reply).toHaveBeenCalledWith(expect.stringContaining(alert1.code));
  expect(validPdf.reply).toHaveBeenCalledWith(expect.stringContaining("cuando termine el análisis"));

  // Replay with same meta_message_id -> does not duplicate D1 row
  await role.handle(validPdf);
  const rows = await env.DB.prepare("SELECT id,r2_key,sha256,status FROM radar_bases_uploads").all<{
    id: string;
    r2_key: string;
    sha256: string;
    status: string;
  }>();
  expect(rows.results?.length).toBe(1);
  expect(rows.results?.[0]?.status).toBe("pending");
  expect(rows.results?.[0]?.r2_key).toBe(`radar-bases/${reg.installationId}/${rows.results?.[0]?.id}`);
  const r2Obj = await env.ENTERPRISE_DOCUMENTS.get(rows.results![0]!.r2_key);
  expect(r2Obj).not.toBeNull();

  // Add second delivery 3 hours later -> without memory, ambiguous!
  clock += 3 * 3_600_000;
  await call("/alerts", reg.token, alert2);
  const ambiguous = makeRoleContext(service, {
    document: { bytes: docxBytes(), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "bases.docx" },
  });
  await role.handle(ambiguous);
  expect(ambiguous.reply).toHaveBeenCalledWith(expect.stringContaining(alert1.code));
  expect(ambiguous.reply).toHaveBeenCalledWith(expect.stringContaining(alert2.code));

  // With memory pointing to delivery 1 -> resolves unambiguously and stores DOCX
  const delivery1 = await env.DB.prepare("SELECT id FROM radar_deliveries WHERE ocid=?").bind(alert1.ocid).first<{ id: string }>();
  const withMemory = makeRoleContext(service, {
    document: { bytes: docxBytes(), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "bases_chalecos.docx" },
    roleState: {
      get: vi.fn(async () => JSON.stringify({
        version: 1,
        channel: phone,
        expiresAt: Date.now() + 3600_000,
        lastMessageId: "prev",
        deliveryId: delivery1!.id,
        turns: [],
      })),
      set: vi.fn(async () => {}),
      clear: vi.fn(),
    } as unknown as RoleHandlerContext["roleState"],
  });
  await role.handle(withMemory);
  expect(withMemory.reply).toHaveBeenCalledWith(expect.stringContaining("bases_chalecos.docx"));
  expect(withMemory.reply).toHaveBeenCalledWith(expect.stringContaining(alert1.code));
});

it("serves pending uploads, streams R2 bytes, isolates installations, and handles ack + rejection notice", async () => {
  const reg = await setupLinkedInstallation(user);
  const otherReg = await setupLinkedInstallation("51988888888");
  await call("/alerts", reg.token, alert1);

  const service = new D1RadarContactService(env.DB, "manolo", phone, user, () => clock, undefined, env.ENTERPRISE_DOCUMENTS);
  const role = new RadarRoleHandler();
  await role.handle(makeRoleContext(service, {
    document: { bytes: pdfBytes("hello-bases"), mimeType: "application/pdf", filename: "bases_lpa.pdf" },
  }));
  clock += 1000;
  await role.handle(makeRoleContext(service, {
    document: { bytes: docxBytes(), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "corrupto.docx" },
  }));

  // Pending list only shows this installation's uploads
  const pendingRes = await call("/bases/pending?limit=10", reg.token);
  expect(pendingRes.status).toBe(200);
  const { uploads } = await pendingRes.json() as { uploads: Array<{ id: string; filename: string; ocid: string; sha256: string; bytes: number }> };
  expect(uploads.length).toBe(2);
  expect(uploads[0]!.filename).toBe("bases_lpa.pdf");
  expect(uploads[0]!.ocid).toBe(alert1.ocid);
  expect(uploads[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);

  const otherPending = await call("/bases/pending?limit=10", otherReg.token);
  expect((await otherPending.json() as { uploads: unknown[] }).uploads).toEqual([]);
  expect((await call(`/bases/${uploads[0]!.id}/content`, otherReg.token)).status).toBe(404);

  // Stream R2 content
  const contentRes = await call(`/bases/${uploads[0]!.id}/content`, reg.token);
  expect(contentRes.status).toBe(200);
  expect(contentRes.headers.get("Content-Type")).toBe("application/pdf");
  expect(await contentRes.text()).toBe("%PDF-1.7\nhello-bases");

  // Ack accepted -> deletes R2 object, removes from pending, returns 410 on content
  const ackOk = await call(`/bases/${uploads[0]!.id}/ack`, reg.token, { status: "accepted" });
  expect(ackOk.status).toBe(200);
  expect((await call(`/bases/${uploads[0]!.id}/content`, reg.token)).status).toBe(410);
  const row0 = await env.DB.prepare("SELECT r2_key,status FROM radar_bases_uploads WHERE id=?").bind(uploads[0]!.id).first<{ r2_key: string; status: string }>();
  expect(row0?.status).toBe("accepted");
  expect(await env.ENTERPRISE_DOCUMENTS.get(row0!.r2_key)).toBeNull();

  // Ack rejected -> deletes R2 object and notifies chat while 24h window is open (once!)
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockClear();
  const ackReject = await call(`/bases/${uploads[1]!.id}/ack`, reg.token, {
    status: "rejected",
    reason: "El archivo tiene contraseña y no se pudo abrir.",
  });
  expect(ackReject.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const sentBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as { text: { body: string } };
  expect(sentBody.text.body).toContain("corrupto.docx");
  expect(sentBody.text.body).toContain("El archivo tiene contraseña");

  // Re-acking the same rejected upload does not send a duplicate WhatsApp message
  await call(`/bases/${uploads[1]!.id}/ack`, reg.token, { status: "rejected", reason: "El archivo tiene contraseña" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("sends idempotent preparation-notices only for accepted deliveries and open 24h window", async () => {
  const reg = await setupLinkedInstallation();
  await call("/alerts", reg.token, alert1);
  const fingerprint = "a".repeat(64);

  // Unknown OCID -> 409 accepted_alert_required
  const unknownOcid = await call("/preparation-notices", reg.token, {
    ocid: "ocds-dgv273-seacev3-9999999",
    code: "LP-999",
    jobFingerprint: fingerprint,
    status: "ready",
    summary: "Resumen listo",
  });
  expect(unknownOcid.status).toBe(409);

  // First valid send -> accepted, Meta called once
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockClear();
  const first = await call("/preparation-notices", reg.token, {
    ocid: alert1.ocid,
    code: alert1.code,
    jobFingerprint: fingerprint,
    status: "ready",
    summary: "• 500 chalecos institucionales\n• Entrega en Lima en 15 días",
    portalUrl: "https://radar.meowlab.tech/app",
  });
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ status: "accepted" });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // Idempotent retry -> replayed: true, Meta NOT called again
  const replay = await call("/preparation-notices", reg.token, {
    ocid: alert1.ocid,
    code: alert1.code,
    jobFingerprint: fingerprint,
    status: "ready",
    summary: "• 500 chalecos institucionales\n• Entrega en Lima en 15 días",
  });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ status: "accepted", replayed: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // Closed 24h window -> 409 window_closed
  clock += 25 * 3_600_000;
  const closed = await call("/preparation-notices", reg.token, {
    ocid: alert1.ocid,
    code: alert1.code,
    jobFingerprint: "b".repeat(64),
    status: "partial",
    summary: "Resumen parcial",
  });
  expect(closed.status).toBe(409);
  expect(await closed.json()).toEqual({ status: "window_closed" });
});
