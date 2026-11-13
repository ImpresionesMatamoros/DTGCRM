const response = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response(405, { error: "method" });
  const token = request.headers.get("x-dtg-website-token") ?? "";
  if (token.length < 40 || token.length > 256) return response(401, { error: "unauthorized" });
  if (Number(request.headers.get("Content-Length")) > 4096) {
    return response(400, { error: "validation" });
  }

  try {
    if (!request.body) return response(400, { error: "validation" });
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        return response(400, { error: "validation" });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return response(400, { error: "validation" });
    }
    if (!data || Array.isArray(data) || typeof data !== "object" ||
        typeof data.submissionId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.submissionId) ||
        data.consent !== true || data.website !== "" ||
        typeof data.name !== "string" || typeof data.phone !== "string" ||
        typeof data.city !== "string" || typeof data.email !== "string" ||
        typeof data.company !== "string") {
      return response(400, { error: "validation" });
    }

    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    if (!key || !url) return response(503, { error: "unavailable" });
    const result = await fetch(url + "/rest/v1/rpc/receive_public_client_details", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_token: token,
        p_submission: data.submissionId,
        p_name: data.name,
        p_phone: data.phone,
        p_city: data.city,
        p_email: data.email,
        p_company: data.company,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) return response(503, { error: "unavailable" });
    switch (await result.json()) {
      case "saved": return response(200, { ok: true });
      case "validation": return response(400, { error: "validation" });
      case "conflict": return response(409, { error: "conflict" });
      case "unauthorized": return response(401, { error: "unauthorized" });
      default: return response(503, { error: "unavailable" });
    }
  } catch {
    return response(503, { error: "unavailable" });
  }
});
