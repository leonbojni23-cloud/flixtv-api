/**
 * Provider integration boundary.
 * Only implement this adapter against a documented API that you are authorized to use.
 * It intentionally does not scrape embed pages, defeat anti-bot controls, or extract
 * protected third-party stream URLs.
 */
export async function resolveWithCineSrc(media) {
  const enabled = process.env.CINESRC_ENABLED === "true";
  const baseUrl = process.env.CINESRC_API_BASE_URL || "";
  if (!enabled || !baseUrl) {
    return {
      provider: "cinesrc",
      available: false,
      reason: "Provider is not configured"
    };
  }

  let parsed;
  try { parsed = new URL(baseUrl); }
  catch { throw Object.assign(new Error("CINESRC_API_BASE_URL must be a valid HTTPS URL"), { statusCode: 500 }); }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error("CINESRC_API_BASE_URL must use HTTPS"), { statusCode: 500 });
  }

  return {
    provider: "cinesrc",
    available: false,
    reason: "A documented, authorized CineSrc API contract has not been configured",
    media
  };
}
