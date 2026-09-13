const TARGET_URL = "https://facturas.meowlab.tech/internal/manolo/health";
const MAX_BODY_LENGTH = 1_024;

export default {
  async fetch(): Promise<Response> {
    const startedAt = Date.now();
    try {
      const response = await fetch(TARGET_URL, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "manolo-worker-connectivity-probe/1.0" },
      });
      const body = (await response.text()).slice(0, MAX_BODY_LENGTH);
      return Response.json({
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - startedAt,
        body,
      });
    } catch (error) {
      return Response.json({
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "unknown_fetch_error",
      }, { status: 502 });
    }
  },
} satisfies ExportedHandler;
