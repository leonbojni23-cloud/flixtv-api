import { applyCors, authorize, sendJson } from "./_lib/http.js";
import { parseMediaPath } from "./_lib/validation.js";
import { discoverSources } from "./_lib/source-manager.js";

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return sendJson(res, 405, { success: false, error: "Method not allowed" });
  }

  const path = Array.isArray(req.query.path) ? req.query.path.join("/") : String(req.query.path || "");
  try {
    if (path === "health") {
      return sendJson(res, 200, {
        success: true,
        status: "ok",
        service: "flixtv-api",
        platform: "vercel",
        timestamp: new Date().toISOString()
      });
    }
    if (path === "warmup") {
      return sendJson(res, 200, { success: true, status: "ready", platform: "vercel", timestamp: new Date().toISOString() });
    }
    if (!path.startsWith("v1/stream/")) {
      return sendJson(res, 404, { success: false, error: "Route not found" });
    }
    if (!authorize(req, res)) return;

    const parsed = parseMediaPath(path);
    if (!parsed || parsed.kind !== "media") {
      return sendJson(res, 404, { success: false, error: "Route not found" });
    }
    const result = await discoverSources(parsed.media);
    return sendJson(res, 200, result);
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, {
      success: false,
      error: status >= 500 ? "Internal server error" : error.message
    });
  }
}
