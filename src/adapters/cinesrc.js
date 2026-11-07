/**
 * Safe CineSrc adapter boundary. It deliberately does not scrape embed HTML,
 * reverse engineer private endpoints, defeat anti-bot systems, or extract
 * protected media URLs. Implement only against an authorized documented API.
 */
import { config } from "../config.js";
export async function resolveWithCineSrc(media) {
  if (!config.cinesrcEnabled || !config.cinesrcBaseUrl) {
    return { available: false, provider: "cinesrc", reason: "CineSrc integration is not configured" };
  }
  let base;
  try { base = new URL(config.cinesrcBaseUrl); }
  catch { throw new Error("CINESRC_BASE_URL must be a valid HTTPS URL"); }
  if (base.protocol !== "https:") throw new Error("CINESRC_BASE_URL must use HTTPS");
  return {
    available: false,
    provider: "cinesrc",
    reason: "No authorized CineSrc API contract has been configured",
    configuredHost: base.host,
    media
  };
}
