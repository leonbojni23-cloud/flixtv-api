import { prepareApiRequest } from "./_lib/handler.js";
import { sendJson } from "./_lib/http.js";

export default function handler(req, res) {
  if (!prepareApiRequest(req, res)) return;
  return sendJson(res, 200, {
    success: true,
    status: "ok",
    service: "flixtv-api",
    platform: "vercel",
    timestamp: new Date().toISOString()
  });
}
