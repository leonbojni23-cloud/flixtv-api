// lib/m3u8.js

/**
 * Kthen një URL absolute për çdo URI të playlist-it, përfshirë URL-të
 * absolute, relative dhe ato të vendosura në atributet URI="...".
 */
function toAbsoluteUrl(uri, baseUrl) {
  const value = uri.trim();
  if (!value || /^(data:|skd:)/i.test(value)) return value;
  return new URL(value, baseUrl).href;
}

function toProxyUrl(uri, baseUrl, proxyBase) {
  const absolute = toAbsoluteUrl(uri, baseUrl);
  if (!/^https?:\/\//i.test(absolute)) return uri;
  return `${proxyBase}${encodeURIComponent(absolute)}`;
}

export function rewritePlaylist(playlistText, originalUrl, proxyBase) {
  const baseUrl = new URL(originalUrl);

  return playlistText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rishkruaj të gjitha atributet URI në EXT-X-MAP, EXT-X-KEY,
      // EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF etj.
      if (trimmed.startsWith('#')) {
        return line.replace(/(URI=)(["'])(.*?)\2/gi, (match, prefix, quote, uri) => {
          const rewritten = toProxyUrl(uri, baseUrl, proxyBase);
          return `${prefix}${quote}${rewritten}${quote}`;
        });
      }

      // Çdo rresht URI i playlist-it mund të jetë relative ose absolute.
      // Ruajmë indentimin dhe hapësirat fundore të rreshtit.
      const leadingWhitespace = line.match(/^\s*/)?.[0] ?? '';
      const trailingWhitespace = line.match(/\s*$/)?.[0] ?? '';
      const uri = trimmed;

      try {
        return `${leadingWhitespace}${toProxyUrl(uri, baseUrl, proxyBase)}${trailingWhitespace}`;
      } catch {
        // Mos e prish playlist-in nëse rreshti nuk është URL e vlefshme.
        return line;
      }
    })
    .join('\n');
}
