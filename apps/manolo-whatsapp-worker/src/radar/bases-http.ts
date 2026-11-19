import type { RadarInstallation } from "./contracts";
import { RADAR_API_PATH } from "./contracts";
import { readLimitedJson } from "./http";
import { RadarStore } from "./store";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

const UUID_RE = /^[a-f0-9-]{36}$/i;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/i;

function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
}

function cleanMultiline(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0009\u000b-\u001f]/gu, "").trim().slice(0, max);
}

function safeHttpsUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500 || /[\u0000-\u001f]/u.test(value)) return "";
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

async function sendMetaText(
  env: Env,
  installation: RadarInstallation,
  bodyText: string,
): Promise<{ state: "accepted" | "unknown" | "rejected"; providerId: string | null }> {
  let state: "accepted" | "unknown" | "rejected" = "unknown";
  let providerId: string | null = null;
  try {
    const response = await fetch(
      `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${installation.phone_number_id}/messages`,
      {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: installation.recipient,
          type: "text",
          text: { preview_url: false, body: bodyText.slice(0, 4096) },
        }),
      },
    );
    if (response.ok) {
      const data = await readLimitedJson(response, 16_384) as { messages?: { id?: unknown }[] };
      const id = data.messages?.[0]?.id;
      if (typeof id === "string" && id.length > 0 && id.length <= 512) {
        providerId = id;
        state = "accepted";
      }
    } else {
      state = response.status >= 500 || response.status === 408 ? "unknown" : "rejected";
      await response.body?.cancel();
    }
  } catch {
    /* Transport ambiguity: leave unknown so retries remain idempotent. */
  }
  return { state, providerId };
}

export async function radarBasesHttp(
  request: Request,
  env: Env,
  store: RadarStore,
  installation: RadarInstallation,
  now: () => number,
): Promise<Response> {
  if (!installation.recipient || !installation.opted_in_at) return json({ error: "not_linked" }, 403);
  const url = new URL(request.url);
  const path = url.pathname.slice(RADAR_API_PATH.length);

  if (path === "/bases/pending" && request.method === "GET") {
    const rawLimit = Number(url.searchParams.get("limit") ?? "10");
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 10;
    const { results } = await store.db.prepare(`SELECT id,delivery_id,ocid,code,filename,mime_type,sha256,byte_size,created_at
      FROM radar_bases_uploads
      WHERE installation_id=? AND status='pending' AND expires_at>?
      ORDER BY created_at ASC, id ASC LIMIT ?`)
      .bind(installation.id, now(), limit)
      .all<{
        id: string;
        delivery_id: string;
        ocid: string;
        code: string;
        filename: string;
        mime_type: string;
        sha256: string;
        byte_size: number;
        created_at: number;
      }>();

    return json({
      uploads: (results ?? []).map((row) => ({
        id: row.id,
        deliveryId: row.delivery_id,
        ocid: row.ocid,
        code: row.code,
        filename: row.filename,
        mimeType: row.mime_type,
        sha256: row.sha256,
        bytes: row.byte_size,
        createdAt: row.created_at,
      })),
    });
  }

  const contentMatch = /^\/bases\/([^/]+)\/content$/.exec(path);
  if (contentMatch && request.method === "GET") {
    const uploadId = contentMatch[1]!;
    if (!UUID_RE.test(uploadId)) return json({ error: "not_found" }, 404);
    const row = await store.db.prepare(
      "SELECT id,r2_key,filename,mime_type,status,expires_at FROM radar_bases_uploads WHERE id=? AND installation_id=? LIMIT 1",
    )
      .bind(uploadId, installation.id)
      .first<{ id: string; r2_key: string; filename: string; mime_type: string; status: string; expires_at: number }>();
    if (!row) return json({ error: "not_found" }, 404);
    if (row.status !== "pending" || row.expires_at <= now()) return json({ error: "upload_unavailable" }, 410);
    const object = await env.ENTERPRISE_DOCUMENTS?.get(row.r2_key);
    if (!object) return json({ error: "not_found" }, 404);

    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      },
    });
  }

  const ackMatch = /^\/bases\/([^/]+)\/ack$/.exec(path);
  if (ackMatch && request.method === "POST") {
    const uploadId = ackMatch[1]!;
    if (!UUID_RE.test(uploadId)) return json({ error: "not_found" }, 404);
    let body: Record<string, unknown>;
    try {
      const parsed = await readLimitedJson(request, 8192);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_request" }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    if (body.status !== "accepted" && body.status !== "rejected") return json({ error: "invalid_request" }, 400);
    const ackStatus = body.status;
    const reason = cleanLine(body.reason, 400) || null;
    if (ackStatus === "rejected" && body.reason !== undefined && typeof body.reason !== "string") {
      return json({ error: "invalid_request" }, 400);
    }

    const existing = await store.db.prepare(
      "SELECT id,status,r2_key,code,filename FROM radar_bases_uploads WHERE id=? AND installation_id=? LIMIT 1",
    )
      .bind(uploadId, installation.id)
      .first<{ id: string; status: string; r2_key: string; code: string; filename: string }>();
    if (!existing) return json({ error: "not_found" }, 404);

    const transitioned = await store.db.prepare(`UPDATE radar_bases_uploads
      SET status=?,error_reason=?,updated_at=?
      WHERE id=? AND installation_id=? AND status='pending'
      RETURNING id,code,filename,r2_key`)
      .bind(ackStatus, ackStatus === "rejected" ? reason : null, now(), uploadId, installation.id)
      .first<{ id: string; code: string; filename: string; r2_key: string }>();

    await env.ENTERPRISE_DOCUMENTS?.delete(existing.r2_key).catch(() => {});

    if (transitioned && ackStatus === "rejected") {
      const win = await store.window(installation, now());
      if (win.open && env.META_ACCESS_TOKEN && /^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)) {
        const detail = reason || "No pudimos validar el archivo como un PDF o Word (.docx) legible.";
        const notice = [
          `No pude procesar «${transitioned.filename}» para la convocatoria ${transitioned.code}.`,
          detail,
          "Envíame un PDF sin contraseña o un .docx válido por este chat, o súbelo desde la plataforma.",
        ].join("\n\n");
        await sendMetaText(env, installation, notice);
      }
    }

    return json({ ok: true, id: existing.id, status: transitioned ? ackStatus : existing.status });
  }

  if (path === "/preparation-notices" && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      const parsed = await readLimitedJson(request, 16_384);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_request" }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_request" }, 400);
    }

    const ocid = cleanLine(body.ocid, 200);
    const code = cleanLine(body.code, 200);
    const jobFingerprint = typeof body.jobFingerprint === "string" ? body.jobFingerprint.trim().toLowerCase() : "";
    const prepStatus = body.status;
    const summary = cleanMultiline(body.summary, 3500);
    const portalUrl = safeHttpsUrl(body.portalUrl);

    if (
      !ocid
      || !code
      || !FINGERPRINT_RE.test(jobFingerprint)
      || (prepStatus !== "ready" && prepStatus !== "partial" && prepStatus !== "failed")
      || !summary
      || portalUrl === ""
    ) {
      return json({ error: "invalid_request" }, 400);
    }

    const delivery = await store.db.prepare(`SELECT id FROM radar_deliveries
      WHERE installation_id=? AND phone_number_id=? AND recipient=? AND ocid=? AND state='accepted' LIMIT 1`)
      .bind(installation.id, installation.phone_number_id, installation.recipient, ocid)
      .first<{ id: string }>();
    if (!delivery) return json({ error: "accepted_alert_required" }, 409);

    const existing = await store.db.prepare(
      "SELECT state FROM radar_preparation_notices WHERE installation_id=? AND ocid=? AND job_fingerprint=? LIMIT 1",
    )
      .bind(installation.id, ocid, jobFingerprint)
      .first<{ state: string }>();
    if (existing && existing.state !== "rejected") {
      return json({ status: existing.state === "sending" ? "unknown" : existing.state, replayed: true });
    }

    if (!(await store.window(installation, now())).open) return json({ status: "window_closed" }, 409);
    if (!env.META_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)) return json({ error: "service_unavailable" }, 503);

    const noticeId = crypto.randomUUID();
    const time = now();
    const reserved = await store.db.prepare(`INSERT INTO radar_preparation_notices
      (id,installation_id,phone_number_id,recipient,ocid,job_fingerprint,state,created_at)
      SELECT ?,i.id,i.phone_number_id,i.recipient,?,?,'sending',? FROM radar_installations i
      JOIN radar_windows w ON w.phone_number_id=i.phone_number_id AND w.recipient=i.recipient
      WHERE i.id=? AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL
        AND w.last_user_message_at>? AND w.last_user_message_at<=?
      ON CONFLICT(installation_id,ocid,job_fingerprint) DO UPDATE SET state='sending',created_at=excluded.created_at
        WHERE radar_preparation_notices.state='rejected'
      RETURNING id`)
      .bind(noticeId, ocid, jobFingerprint, time, installation.id, time - 86_400_000, time)
      .first<{ id: string }>();

    if (!reserved) {
      const row = await store.db.prepare(
        "SELECT state FROM radar_preparation_notices WHERE installation_id=? AND ocid=? AND job_fingerprint=? LIMIT 1",
      )
        .bind(installation.id, ocid, jobFingerprint)
        .first<{ state: string }>();
      if (row && row.state !== "rejected") {
        return json({ status: row.state === "sending" ? "unknown" : row.state, replayed: true });
      }
      return json({ status: "window_closed" }, 409);
    }

    const heading = prepStatus === "ready"
      ? `*Resumen listo · ${code}*`
      : prepStatus === "partial"
        ? `*Resumen parcial · ${code}*`
        : `*No pude completar el análisis · ${code}*`;
    const bodyText = [heading, summary, portalUrl ? `Ver en la plataforma:\n${portalUrl}` : null]
      .filter(Boolean)
      .join("\n\n");

    const { state, providerId } = await sendMetaText(env, installation, bodyText);
    await store.db.prepare("UPDATE radar_preparation_notices SET state=?,provider_message_id=? WHERE id=?")
      .bind(state, providerId, reserved.id)
      .run();

    return json({ status: state });
  }

  return json({ error: "not_found" }, 404);
}
