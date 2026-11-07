const allowedOrigins = () => (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);

export function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowed = allowedOrigins();
  if (origin && allowed.length > 0 && !allowed.includes(origin)) {
    sendJson(res, 403, { success: false, error: "Origin not allowed" });
    return false;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", allowed.length > 0 ? origin : "*");
    if (allowed.length > 0) res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  return true;
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function authorize(req, res) {
  const secret = process.env.API_SHARED_SECRET;
  if (!secret) return true;
  if (req.headers.authorization === `Bearer ${secret}`) return true;
  sendJson(res, 401, { success: false, error: "Unauthorized" });
  return false;
}
