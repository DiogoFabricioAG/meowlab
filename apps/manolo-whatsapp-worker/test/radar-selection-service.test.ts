import { describe, expect, it } from "vitest";
import type { RadarSyncRequest } from "../src/radar/sync-contracts";
import {
  PgRadarSelectionService,
  type RadarSelectionPool,
} from "../src/node/radar/selection-service";

const candidate = {
  alert: {
    ocid: "ocds-5wno2w-123456789",
    code: "AS-10-2026",
    description: "Compra de chalecos",
    buyer: "Entidad pública",
    amount: "S/ 12,000",
    deadline: "2026-11-10",
    sourceUrl: "https://contratacionesabiertas.oece.gob.pe",
  },
};
const base = {
  version: 1 as const,
  tenantId: "tenant-a",
  phoneNumberId: "123456789",
  whatsappUserId: "51999999999",
  installationId: "install-a",
};

class FakePool implements RadarSelectionPool {
  readonly calls: string[] = [];
  allowed = true;
  private requests = new Map<string, { request_hash: string; response: unknown }>();
  private installations = new Map<string, { delivered_cursor: number; acked_cursor: number }>();
  private candidates = new Map<string, typeof candidate>();
  private changes: Array<{ seq: number; ocid: string; state: "interesting" | "dismissed"; changed_at: Date; candidate: typeof candidate }> = [];
  private metas = new Map<string, { payload_hash: string; seq: number }>();
  private seq = 0;

  async connect() {
    return {
      query: async <T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        values: readonly unknown[] = [],
      ): Promise<{ rows: T[] }> => {
        this.calls.push(sql.trim());
        let rows: Record<string, unknown>[] = [];
        if (sql.includes("SELECT contact.id AS contact_id")) rows = this.allowed ? [{ contact_id: 7 }] : [];
        else if (sql.includes("SELECT 1 FROM whatsapp.radar_sync_installations")) {
          const item = this.installations.get(String(values[0]));
          rows = item ? [{ ok: 1 }] : [];
        } else if (sql.includes("SELECT request_hash, response")) {
          const item = this.requests.get(String(values[3]));
          rows = item ? [item] : [];
        } else if (sql.includes("INSERT INTO whatsapp.radar_sync_installations")) {
          if (!this.installations.has(String(values[0]))) this.installations.set(String(values[0]), { delivered_cursor: 0, acked_cursor: 0 });
        } else if (sql.includes("INSERT INTO whatsapp.radar_candidate_snapshots")) {
          this.candidates.set(String(values[3]), JSON.parse(String(values[4])));
        } else if (sql.includes("SELECT candidate FROM whatsapp.radar_candidate_snapshots")) {
          const item = this.candidates.get(String(values[3]));
          rows = item ? [{ candidate: item }] : [];
        } else if (sql.includes("SELECT payload_hash, seq FROM whatsapp.radar_meta_selections")) {
          const item = this.metas.get(String(values[3])); rows = item ? [item] : [];
        } else if (sql.includes("UPDATE whatsapp.radar_selection_counters SET last_seq")) {
          this.seq += 1; rows = [{ last_seq: this.seq }];
        } else if (sql.includes("INSERT INTO whatsapp.radar_selection_changes")) {
          const row = { seq: Number(values[3]), ocid: String(values[4]), state: values[5] as "interesting" | "dismissed", changed_at: new Date("2026-10-31T00:00:00Z"), candidate: JSON.parse(String(values[6])) };
          this.changes.push(row); rows = [row];
        } else if (sql.includes("INSERT INTO whatsapp.radar_meta_selections")) {
          this.metas.set(String(values[3]), { payload_hash: String(values[4]), seq: Number(values[5]) });
        } else if (sql.includes("SELECT seq, ocid, state, changed_at, candidate FROM whatsapp.radar_selection_changes")) {
          const row = this.changes.find((item) => item.seq === Number(values[3])); rows = row ? [row] : [];
        } else if (sql.includes("SELECT seq, ocid, state, changed_at, candidate")) {
          rows = this.changes.filter((item) => item.seq > Number(values[3])).slice(0, Number(values[4]));
        } else if (sql.includes("SELECT delivered_cursor AS last_seq")) {
          const item = this.installations.get(String(values[0])); rows = item ? [{ last_seq: item.delivered_cursor }] : [];
        } else if (sql.includes("SELECT last_seq FROM whatsapp.radar_selection_counters")) rows = [{ last_seq: this.seq }];
        else if (sql.includes("SET delivered_cursor = GREATEST")) {
          const item = this.installations.get(String(values[0])); if (item) item.delivered_cursor = Math.max(item.delivered_cursor, Number(values[1]));
        } else if (sql.includes("SET acked_cursor = GREATEST")) {
          const item = this.installations.get(String(values[0])); if (item) { item.acked_cursor = Math.max(item.acked_cursor, Number(values[1])); rows = [{ last_seq: item.acked_cursor }]; }
        } else if (sql.includes("INSERT INTO whatsapp.radar_sync_requests")) {
          this.requests.set(String(values[3]), { request_hash: String(values[4]), response: JSON.parse(String(values[5])) });
        }
        return { rows: rows as T[] };
      },
      release: () => undefined,
    };
  }
}

function request(fields: Partial<RadarSyncRequest>): RadarSyncRequest {
  return { ...base, version: 1, requestId: "req-1", operation: "publish_candidates", candidates: [candidate], ...fields } as RadarSyncRequest;
}

describe("PgRadarSelectionService", () => {
  it("publishes idempotently, records a selection once, and replays Meta events safely", async () => {
    const pool = new FakePool();
    const service = new PgRadarSelectionService(pool);
    const publish = request({});
    expect((await service.execute(publish, "hash-a")).published).toBe(1);
    expect((await service.execute(publish, "hash-a")).published).toBe(1);
    expect(await service.execute(publish, "different-hash")).toMatchObject({ status: "conflict" });

    const select = request({ requestId: "select-1", operation: "select_candidate", candidates: undefined, ocid: candidate.alert.ocid, state: "interesting", metaMessageId: "wamid-button-1" });
    const first = await service.execute(select, "select-hash");
    expect(first.selection).toMatchObject({ seq: 1, ocid: candidate.alert.ocid, state: "interesting" });
    const retry = await service.execute(request({ ...select, requestId: "select-retry" }), "select-hash-retry");
    expect(retry.selection?.seq).toBe(1);
    const changedReplay = await service.execute(request({ ...select, requestId: "select-conflict", state: "dismissed" }), "select-hash-conflict");
    expect(changedReplay.status).toBe("conflict");
    expect(pool.calls.filter((sql) => sql.includes("INSERT INTO whatsapp.radar_selection_changes"))).toHaveLength(1);
  });

  it("pulls ordered changes per installation and rejects ACK beyond issued cursor", async () => {
    const pool = new FakePool();
    const service = new PgRadarSelectionService(pool);
    await service.execute(request({}), "publish");
    await service.execute(request({ requestId: "select-1", operation: "select_candidate", candidates: undefined, ocid: candidate.alert.ocid, state: "interesting", metaMessageId: "wamid-1" }), "select");

    const pull = request({ requestId: "pull-1", operation: "pull_changes", candidates: undefined, after: 0, limit: 100 });
    const response = await service.execute(pull, "pull");
    expect(response).toMatchObject({ status: "ok", cursor: 1, changes: [{ seq: 1 }] });
    const badAck = await service.execute(request({ requestId: "ack-bad", operation: "ack_changes", candidates: undefined, cursor: 2 }), "ack-bad");
    expect(badAck.status).toBe("conflict");
    const ack = await service.execute(request({ requestId: "ack-good", operation: "ack_changes", candidates: undefined, cursor: 1 }), "ack-good");
    expect(ack).toMatchObject({ status: "ok", ackedCursor: 1 });
  });

  it("does not authorize contacts without the RADAR effective role", async () => {
    const pool = new FakePool(); pool.allowed = false;
    const response = await new PgRadarSelectionService(pool).execute(request({}), "hash");
    expect(response.status).toBe("forbidden");
    expect(pool.calls.some((sql) => sql.includes("INSERT INTO whatsapp.radar_candidate_snapshots"))).toBe(false);
  });
});
