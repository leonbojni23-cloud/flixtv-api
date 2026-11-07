import { getStreamData } from "./cinesrc.js";

function publicBaseUrl() {
  const configured = process.env.PUBLIC_API_BASE_URL;
  if (configured) return configured.replace(/\\/$/, "");
  if (process.env.VERCEL_URL) return "https://" + process.env.VERCEL_URL;
  return "";
}

export async function discoverSources(media) {
  if (process.env.CINESRC_ENABLED !== "true") {
    const provider = { provider: "cinesrc", available: false, reason: "CineSRC is disabled" };
    return { success: true, media, sources: [], providers: [provider], message: "No playback source available" };
  }

  const data = await getStreamData(media);
  const base = publicBaseUrl();
  if (!base) throw Object.assign(new Error("Set PUBLIC_API_BASE_URL or use Vercel deployment URL"), { statusCode: 500 });
  const proxy = (url) => base + "/api/proxy?url=" + encodeURIComponent(url);
  const provider = {
    provider: "cinesrc",
    available: true,
    streamUrl: proxy(data.rawM3U8),
    subtitles: data.subtitles.map((track) => ({ ...track, url: proxy(track.url) }))
  };
  return {
    success: true,
    media,
    sources: [provider],
    providers: [provider],
    message: null
  };
}
