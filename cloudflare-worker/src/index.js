/**
 * Cloudflare Worker gateway. Secrets: BACKEND_URL, BACKEND_SECRET.
 * Variable: ALLOWED_ORIGINS (comma-separated exact FLIXTV origins).
 * This forwards API metadata only; it does not proxy video segments.
 */
const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "null",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin"
});
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
    const allowedOrigin = origin && allowed.includes(origin) ? origin : null;
    if (origin && !allowedOrigin) return Response.json({ success: false, error: "Origin not allowed" }, { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    if (!env.BACKEND_URL || !env.BACKEND_SECRET) return Response.json({ success: false, error: "Gateway is not configured" }, { status: 503 });
    if (!url.pathname.startsWith("/api/v1/") && !["/health", "/warmup"].includes(url.pathname)) {
      return Response.json({ success: false, error: "Route not found" }, { status: 404 });
    }
    const backend = new URL(env.BACKEND_URL);
    if (backend.protocol !== "https:") return Response.json({ success: false, error: "Backend must use HTTPS" }, { status: 500 });
    const target = new URL(url.pathname + url.search, backend);
    try {
      const response = await fetch(target, {
        method: "GET",
        headers: { Authorization: `Bearer ${env.BACKEND_SECRET}`, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(12000)
      });
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(allowedOrigin))) headers.set(key, value);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return Response.json({ success: false, error: "Backend temporarily unavailable" }, { status: 502, headers: corsHeaders(allowedOrigin) });
    }
  }
};
