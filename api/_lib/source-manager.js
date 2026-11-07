import { resolveWithCineSrc } from "./cinesrc.js";

export async function discoverSources(media) {
  const provider = await resolveWithCineSrc(media);
  return {
    success: true,
    media,
    sources: provider.available ? [provider] : [],
    providers: [provider],
    message: provider.available ? null : "No authorized playback provider is currently available"
  };
}
