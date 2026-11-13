import { afterEach, describe, expect, it, vi } from "vitest";
import { FacturayaApiClient } from "../src/adapters/facturaya/client";
import { guideDraft, guideId, despatchPayload } from "./despatch-fixture";

afterEach(() => vi.unstubAllGlobals());
describe("GRE legacy API client", () => {
  it("creates immutable drafts with key and uses digest confirmation, get and ticket status routes", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ data: guideDraft }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient("https://factura.example", "company-token", vi.fn());
    const input = { ...despatchPayload, idempotency_key: "gre:revision-1" };
    await expect(client.despatch.create(input)).resolves.toMatchObject({ ok: true, data: { id: guideId, is_demo: true } });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(input);
    await client.despatch.issue(guideId, guideDraft.confirmation_digest);
    expect(fetchMock).toHaveBeenLastCalledWith(`https://factura.example/api/despatches/${guideId}/issue`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ confirmed: true, confirmation_digest: guideDraft.confirmation_digest }) }));
    await client.despatch.get(guideId);
    expect(fetchMock).toHaveBeenLastCalledWith(`https://factura.example/api/despatches/${guideId}`, expect.objectContaining({ method: "GET" }));
    await client.despatch.refresh(guideId);
    expect(fetchMock).toHaveBeenLastCalledWith(`https://factura.example/api/despatches/${guideId}/status`, expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls.every(([, init]) => (init?.headers as Record<string, string>).Authorization === "Bearer company-token")).toBe(true);
  });
  it("rejects a response belonging to a different guide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { ...guideDraft, id: despatchPayload.invoice_id } })));
    const client = new FacturayaApiClient("https://factura.example", "company-token", vi.fn());
    await expect(client.despatch.get(guideId)).resolves.toMatchObject({ ok: false, reason: "api_error" });
  });
  it("retrieves XML/CDR privately without publishing credentials or sending them to Meta", async () => {
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) => new Response("private-file", { headers: { "Content-Type": "application/zip" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FacturayaApiClient("https://factura.example", "company-token", vi.fn());
    for (const kind of ["xml", "cdr"]) {
      await expect(client.downloadFile(`/api/despatches/${guideId}/files/${kind}`)).resolves.toMatchObject({ ok: true });
      expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(`https://factura.example/api/despatches/${guideId}/files/${kind}`);
    }
    await expect(client.downloadFile("https://external.example/files/cdr")).resolves.toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
