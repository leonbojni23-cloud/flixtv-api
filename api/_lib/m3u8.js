/**
 * Rewrites an HLS media/master playlist without changing its tags or metadata.
 * The caller must provide a server-side proxy URL builder; never expose upstream
 * URLs directly to the browser when the provider agreement forbids redistribution.
 */
export function rewritePlaylist(playlistText, originalUrl, toProxyUrl) {
  if (typeof playlistText !== "string" || !playlistText.startsWith("#EXTM3U")) {
    throw new Error("Invalid HLS playlist");
  }
  if (typeof toProxyUrl !== "function") throw new Error("A proxy URL builder is required");

  const base = new URL(originalUrl);
  if (base.protocol !== "https:") throw new Error("HLS source must use HTTPS");

  const proxy = (value) => {
    const target = new URL(value, base);
    if (target.protocol !== "https:") throw new Error("HLS resources must use HTTPS");
    return toProxyUrl(target.href);
  };

  return playlistText.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxy(uri)}"`);
    }

    return proxy(trimmed);
  }).join("\n");
}
