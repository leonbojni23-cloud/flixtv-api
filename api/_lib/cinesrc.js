const DOMAINS = [
  "https://cinesrc.st",
  "https://cinesrc.com",
  "https://cinesrc.to",
  "https://cinesrc.net"
];

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

async function fetchEmbed(domain, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(new URL(path, domain), {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
      redirect: "follow"
    });
    if (!response.ok) throw new Error("CineSRC returned HTTP " + response.status);
    const html = await response.text();
    if (html.length < 200) throw new Error("CineSRC returned an incomplete page");
    return { html, baseUrl: response.url || domain };
  } finally {
    clearTimeout(timeout);
  }
}

function extractStream(html, baseUrl) {
  const patterns = [
    /["'](https?:\/\/[^"'\s]+?\.m3u8[^"'\\s]*)["']/i,
    /(?:file|src|url)\s*[:=]\s*["']([^"']+?\.m3u8[^"']*)["']/i,
    /(https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const candidate = match[1].replace(/\\\//g, "/").replace(/\\/g, "");
    try {
      const url = new URL(candidate, baseUrl);
      if (url.protocol === "https:" && /\.m3u8(?:$|[?#])/i.test(url.href)) return url.href;
    } catch {}
  }
  return null;
}

function extractSubtitles(html, baseUrl) {
  const found = new Map();
  const trackPattern = /<track\b[^>]*>/gi;
  for (const tag of html.match(trackPattern) || []) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    const lang = tag.match(/\bsrclang=["']([^"']+)["']/i)?.[1]
      || tag.match(/\blabel=["']([^"']+)["']/i)?.[1] || "unknown";
    if (!src) continue;
    try {
      const url = new URL(src, baseUrl);
      if (url.protocol === "https:") found.set(url.href, { lang: lang.toLowerCase(), url: url.href });
    } catch {}
  }
  const jsonMatch = html.match(/"subtitles"\s*:\s*(\[[\s\S]*?\])/i);
  if (jsonMatch) {
    try {
      for (const item of JSON.parse(jsonMatch[1])) {
        const src = item.file || item.url;
        if (!src) continue;
        const url = new URL(src, baseUrl);
        if (url.protocol === "https:") {
          found.set(url.href, {
            lang: String(item.label || item.language || "unknown").toLowerCase(),
            url: url.href
          });
        }
      }
    } catch {}
  }
  return [...found.values()];
}

export async function getStreamData({ id, type = "movie", season, episode }) {
  if (!/^\d+$/.test(String(id))) throw Object.assign(new Error("Invalid TMDB id"), { statusCode: 400 });
  if (type !== "movie" && type !== "tv") throw Object.assign(new Error("Invalid media type"), { statusCode: 400 });
  const path = type === "tv"
    ? "/embed/tv/" + encodeURIComponent(id) + "?s=" + encodeURIComponent(season) + "&e=" + encodeURIComponent(episode)
    : "/embed/movie/" + encodeURIComponent(id);

  const attempts = DOMAINS.map(async (domain) => {
    const page = await fetchEmbed(domain, path);
    const streamUrl = extractStream(page.html, page.baseUrl);
    if (!streamUrl) throw new Error("No HLS playlist found on " + domain);
    return {
      rawM3U8: streamUrl,
      subtitles: extractSubtitles(page.html, page.baseUrl),
      baseUrl: page.baseUrl
    };
  });

  try {
    return await Promise.any(attempts);
  } catch {
    throw Object.assign(new Error("CineSRC did not return a playable HLS source"), { statusCode: 502 });
  }
}
