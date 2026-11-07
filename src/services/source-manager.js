import { resolveWithCineSrc } from "../adapters/cinesrc.js";
export async function discoverSources(media, options = {}) {
  const providers = await Promise.allSettled([resolveWithCineSrc(media, options)]);
  const results = providers.map((result) => result.status === "fulfilled"
    ? result.value
    : { available: false, provider: "unknown", reason: "Provider request failed" });
  return {
    success: true,
    media,
    sources: results.filter((item) => item.available),
    providers: results,
    message: results.some((item) => item.available) ? undefined : "No configured, authorized playback provider is available"
  };
}
