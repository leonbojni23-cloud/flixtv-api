/**
 * Safe CineSrc adapter boundary.
 * No embed-page scraping, private endpoint reverse engineering, or anti-bot bypass.
 * Implement only against an authorized, documented provider API.
 */
import { config } from "../config.js";
export async function resolveWithCineSrc(media, { signal } = {}) {
  if (!config.cinesrcEnabled || !config.cinesrcBaseUrl) {
    return { available: false, provider: "cinesrc", reason: "CineSrc integration is not configured" };
  }
  let base;
  try { base = new URL(config.cinesrcBaseUrl); }
  catch { throw new Error("CINESRC_BASE_URL must be a valid HTTPS URL"); }
  if (base.protocol !== "https:") throw new Error("CINESRC_BASE_URL must use HTTPS");
  // A documented API contract (endpoint, authentication, schemas, permission)
  // is required before making requests. Do not guess an embed URL format.
  void signal;
  return {
    available: false,
    provider: "cinesrc",
    reason: "No authorized CineSrc API contract has been configured",
    configuredHost: base.host,
    media
  };
}
