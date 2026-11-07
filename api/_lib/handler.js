import { applyCors, authorize, sendJson } from "./http.js";

export function prepareApiRequest(req, res, { protectedRoute = false } = {}) {
  if (!applyCors(req, res)) return false;
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    sendJson(res, 405, { success: false, error: "Method not allowed" });
    return false;
  }
  if (protectedRoute && !authorize(req, res)) return false;
  return true;
}
