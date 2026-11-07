// lib/m3u8.js
export function rewritePlaylist(playlistText, originalUrl, proxyBase) {
  const baseUrl = new URL(originalUrl);
  return playlistText.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
          const absolute = new URL(uri, baseUrl).href;
          return `URI="${proxyBase}${encodeURIComponent(absolute)}"`;
        });
      }
      return line;
    }

    const absolute = new URL(trimmed, baseUrl).href;
    return `${proxyBase}${encodeURIComponent(absolute)}`;
  }).join('\n');
}
