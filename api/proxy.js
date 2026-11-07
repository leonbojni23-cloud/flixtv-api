// api/proxy.js
import { rewritePlaylist } from '../lib/m3u8.js';

export const config = { runtime: 'edge' };

const DEFAULT_ALLOWED_HOSTS = ['cinesrc.st', 'bright67.online'];

function isAllowedHost(hostname) {
  const configured = (process.env.PROXY_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  const allowedHosts = [...DEFAULT_ALLOWED_HOSTS, ...configured];

  return allowedHosts.some((allowed) => {
    const normalized = allowed.replace(/^\.+/, '');
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    ...extra
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders({ Allow: 'GET, HEAD, OPTIONS' })
    });
  }

  const requestUrl = new URL(req.url);
  const target = requestUrl.searchParams.get('url');

  if (!target) {
    return new Response('Mungon parametri url', {
      status: 400,
      headers: corsHeaders()
    });
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('URL e pavlefshme', {
      status: 400,
      headers: corsHeaders()
    });
  }

  // Proxy publik pa kufizim host-esh do të krijonte rrezik SSRF.
  if (targetUrl.protocol !== 'https:' || !isAllowedHost(targetUrl.hostname.toLowerCase())) {
    return new Response('Host-i i burimit nuk lejohet', {
      status: 403,
      headers: corsHeaders()
    });
  }

  try {
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'https://cinesrc.st/',
      'Origin': 'https://cinesrc.st',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    // Mbështet Range për seek dhe kërkesa të pjesshme të player-it.
    const range = req.headers.get('range');
    if (range) upstreamHeaders.Range = range;

    const response = await fetch(targetUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: 'follow'
    });

    if (!response.ok && response.status !== 206) {
      return new Response(`Burimi ktheu statusin ${response.status}`, {
        status: response.status,
        headers: corsHeaders({ 'Cache-Control': 'no-store' })
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isM3U8 =
      /\.m3u8(?:$|[?#])/i.test(targetUrl.href) ||
      /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);

    if (isM3U8) {
      const playlist = await response.text();
      const proxyBase = `${requestUrl.origin}/api/proxy?url=`;
      const rewritten = rewritePlaylist(playlist, response.url || targetUrl.href, proxyBase);

      return new Response(req.method === 'HEAD' ? null : rewritten, {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'public, max-age=10, s-maxage=10'
        })
      });
    }

    // Për init.mp4 dhe segmentet fMP4/TS, transmeto body pa e futur
    // të gjithë segmentin në memorie. Mos kopjo Content-Length ose
    // Content-Encoding sepse fetch mund ta ketë dekoduar përgjigjen.
    const responseHeaders = corsHeaders({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600'
    });

    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    if (contentRange) responseHeaders['Content-Range'] = contentRange;
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges;

    return new Response(req.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    return new Response(`Gabim në Proxy: ${error.message}`, {
      status: 502,
      headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    });
  }
}
