/** Private Tender Cat API. Each operation is scoped to a verified portal membership. */
export type TenderService = (company: string, suffix: string, request: Request) => Promise<Response>;

const operations: Record<string, RegExp> = {
  GET: /^(?:opportunities|business|opportunities\/[\w:-]+\/(?:preparation|case-work|market|documents\.zip|documents\/[\w-]+\.docx|bases\/[\w-]+))$/,
  POST: /^(?:sync|opportunities\/[\w:-]+\/(?:preparation|edit-document-ai|market|requirements\/[\w-]+\/market|bases))$/,
  PUT: /^(?:business|opportunities\/[\w:-]+)$/,
  DELETE: /^opportunities\/[\w:-]+\/bases\/[\w-]+$/,
};

export function createTenderService(origin: string | undefined, token: string | undefined, send = fetch): TenderService | undefined {
  if (!origin || !token) return undefined;
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/") {
    throw new Error("Invalid TENDER_SERVICE_URL");
  }
  return async (company, suffix, request) => {
    if (!operations[request.method]?.test(suffix)) return Response.json({ error: "unknown_operation" }, { status: 404 });
    const url = new URL("/api/workspace/" + suffix, base);
    const query = new URL(request.url).searchParams;
    if (request.method === "POST" && suffix.endsWith("/bases")) {
      for (const name of ["filename", "replace"]) {
        const value = query.get(name);
        if (value !== null) url.searchParams.set(name, value);
      }
    }
    const headers = new Headers({ Authorization: "Bearer " + token, "X-MeowLab-Company": company });
    const type = request.headers.get("content-type");
    if (type) headers.set("content-type", type);
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method, headers, redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    };
    if (request.body) {
      init.body = request.body;
      init.duplex = "half";
    }
    try {
      const upstream = await send(url.toString(), init);
      if (upstream.status >= 500 || upstream.status === 401 || (upstream.status >= 300 && upstream.status < 400)) {
        await upstream.body?.cancel();
        return Response.json({ error: "tender_unavailable" }, { status: 503 });
      }
      const outgoing = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
      for (const key of ["content-type", "content-disposition"]) {
        const value = upstream.headers.get(key);
        if (value) outgoing.set(key, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers: outgoing });
    } catch {
      return Response.json({ error: "tender_unavailable" }, { status: 503 });
    }
  };
}
