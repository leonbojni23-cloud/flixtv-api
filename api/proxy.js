import { rewritePlaylist } from "./_lib/m3u8.js";
import { prepareApiRequest } from "./_lib/handler.js";

const DEFAULT_HOSTS = ["cinesrc.st", "cinesrc.com", "cinesrc.to", "cinesrc.net"];

function allowedHosts() {
  return [...new Set([
    ...DEFAULT_HOSTS,
    ...(process.env.CINESRC_MEDIA_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)
  ])];
}

function validateTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid media URL"); }
  if (url.protocol !== "https:") throw new Error("Only HTTPS media URLs are allowed");
  const host = url.hostname.toLowerCase();
  if (!allowedHosts().some((allowed) => host === allowed || host.endsWith("." + allowed))) {
    throw new Error("Media host is not allowlisted. Add it to CINESRC_MEDIA_HOSTS.");
  }
  return url;
}

export default async function handler(req, res) {
  if (!prepareApiRequest(req, res)) return;
  const targetValue = req.query?.url || new URL(req.url, "https://api.invalid").searchParams.get("url");
  if (!targetValue) { res.statusCode = 400; return res.end("Missing url"); }

  try {
    const target = validateTarget(targetValue);
    const headers = { Accept: "*/*" };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(target, { headers, redirect: "follow" });
    validateTarget(upstream.url || target.href);
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      return res.end("Upstream media request failed");
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const isPlaylist = /mpegurl/i.test(contentType) || /\.m3u8(?:$|[?#])/i.test(target.href);
    res.statusCode = upstream.status;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", isPlaylist ? "public, max-age=5" : "public, max-age=300");
    res.setHeader("Content-Type", isPlaylist ? "application/vnd.apple.mpegurl" : contentType);
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    if (isPlaylist) {
      const text = await upstream.text();
      const origin = "https://" + (req.headers.host || process.env.VERCEL_URL);
      const rewritten = rewritePlaylist(text, target.href, (url) =>
        origin + "/api/proxy?url=" + encodeURIComponent(url)
      );
      return res.end(rewritten);
    }

    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) await new Promise((resolve) => res.once("drain", resolve));
      }
      return res.end();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(error.message);
  }
}
