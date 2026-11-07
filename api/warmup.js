import { prepareApiRequest } from "./_lib/handler.js";
import { sendJson } from "./_lib/http.js";

export default function handler(req, res) {
  if (!prepareApiRequest(req, res)) return;
  return sendJson(res, 200, {
    success: true,
    status: "ready",
    platform: "vercel",
    timestamp: new Date().toISOString()
  });
}
