import type { RadarInstallation } from "./contracts";
import { RADAR_API_PATH } from "./contracts";
import { readLimitedJson } from "./http";
import { RadarStore } from "./store";
import { RadarSyncBridgeClient } from "../adapters/radar/sync-bridge-client";
import { isRadarSyncRequest, validateRadarCandidate, type RadarSyncRequest } from "./sync-contracts";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function radarSyncHttp(request: Request, env: Env, store: RadarStore, installation: RadarInstallation, now: () => number): Promise<Response> {
  if (!installation.recipient || !installation.opted_in_at) return json({ error: "not_linked" }, 403);
  const channel = await store.db.prepare("SELECT tenant_id FROM whatsapp_numbers WHERE phone_number_id=? AND active=1")
    .bind(installation.phone_number_id).first<{ tenant_id: string }>();
  if (!channel) return json({ error: "unauthorized_channel" }, 403);
  const url = new URL(request.url), path = url.pathname.slice(RADAR_API_PATH.length);
  let payload: unknown = null;
  if (request.method === "POST") { try { payload = await readLimitedJson(request, 512 * 1024); } catch { return json({ error: "invalid_request" }, 400); } }
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const base = { version: 1 as const, tenantId: channel.tenant_id, phoneNumberId: installation.phone_number_id,
    whatsappUserId: installation.recipient, installationId: installation.id };
  let command: RadarSyncRequest;
  if (path === "/candidates" && request.method === "POST") {
    if (!Array.isArray(body.candidates)) return json({ error: "invalid_candidates" }, 400);
    const candidates = body.candidates.map(validateRadarCandidate);
    if (candidates.some(c => !c)) return json({ error: "invalid_candidates" }, 400);
    command = { ...base, requestId: body.requestId as string, operation: "publish_candidates", candidates: candidates as NonNullable<typeof candidates[number]>[] };
  } else if (path === "/sync" && request.method === "GET") {
    command = { ...base, requestId: crypto.randomUUID(), operation: "pull_changes",
      after: Number(url.searchParams.get("after") ?? "0"), limit: Number(url.searchParams.get("limit") ?? "100") };
  } else if (path === "/sync/ack" && request.method === "POST") {
    command = { ...base, requestId: body.requestId as string, operation: "ack_changes", cursor: body.cursor as number };
  } else return json({ error: "not_found" }, 404);
  if (!isRadarSyncRequest(command)) return json({ error: "invalid_request" }, 400);
  if (!await store.rateLimit(`sync:${installation.id}`, 1800, now())) return json({ error: "rate_limited" }, 429);
  const response = await new RadarSyncBridgeClient(env).execute(command);
  if (!response) return json({ error: "sync_unavailable" }, 503);
  return json(response, response.status === "forbidden" ? 403 : response.status === "conflict" ? 409 : 200);
}
