import { resolveWithCineSrc } from "../adapters/cinesrc.js";
export async function discoverSources(media) {
  const provider = await resolveWithCineSrc(media);
  return {
    success: true,
    media,
    sources: provider.available ? [provider] : [],
    providers: [provider],
    message: provider.available ? undefined : "No configured, authorized playback provider is available"
  };
}
