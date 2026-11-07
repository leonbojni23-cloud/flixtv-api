import { prepareApiRequest } from "../../../_lib/handler.js";
import { sendJson } from "../../../_lib/http.js";
import { parseMovie } from "../../../_lib/validation.js";
import { discoverSources } from "../../../_lib/source-manager.js";

export default async function handler(req, res) {
  if (!prepareApiRequest(req, res, { protectedRoute: true })) return;
  try {
    const media = parseMovie(req.query.id);
    return sendJson(res, 200, await discoverSources(media));
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return sendJson(res, status, { success: false, error: status >= 500 ? "Internal server error" : error.message });
  }
}
