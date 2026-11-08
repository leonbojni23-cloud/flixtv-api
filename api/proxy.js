// api/proxy.js
import { rewritePlaylist } from '../lib/m3u8.js';

export const config = { runtime: 'edge' };

const DEFAULT_ALLOWED_HOSTS = ['cinesrc.st', 'bright67.online'];

function isAllowedHost(hostname) {
  const configured = (process.env.PROXY_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return [...DEFAULT_ALLOWED_HOSTS, ...configured].some((allowed) => {
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

function jsonError(message, status) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
  });
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

  if (!target) return jsonError('Mungon parametri url', 400);

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonError('URL e pavlefshme', 400);
  }

  if (targetUrl.protocol !== 'https:' || !isAllowedHost(targetUrl.hostname.toLowerCase())) {
    return jsonError('Host-i i burimit nuk lejohet', 403);
  }

  try {
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'https://cinesrc.st/',
      'Origin': 'https://cinesrc.st',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    const range = req.headers.get('range');
    if (range) upstreamHeaders.Range = range;

    const response = await fetch(targetUrl.href, {
      method: req.method,
      headers: upstreamHeaders,
      redirect: 'follow'
    });

    // Kontrollo edhe URL-në pas redirect-it, jo vetëm URL-në fillestare.
    const finalUrl = new URL(response.url || targetUrl.href);
    if (finalUrl.protocol !== 'https:' || !isAllowedHost(finalUrl.hostname.toLowerCase())) {
      try { await response.body?.cancel(); } catch {}
      return jsonError('Redirect-i çoi te një host i palejuar', 403);
    }

    if (!response.ok && response.status !== 206) {
      const headers = corsHeaders({ 'Cache-Control': 'no-store' });
      const contentRange = response.headers.get('content-range');
      if (contentRange) headers['Content-Range'] = contentRange;
      return new Response(`Burimi ktheu statusin ${response.status}`, {
        status: response.status,
        headers
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const isM3U8 =
      /\.m3u8(?:$|[?#])/i.test(finalUrl.href) ||
      /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);

    if (isM3U8) {
      if (req.method === 'HEAD') {
        return new Response(null, {
          status: response.status,
          headers: corsHeaders({
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
            'Cache-Control': 'no-store'
          })
        });
      }

      const playlist = await response.text();
      if (!playlist.trimStart().startsWith('#EXTM3U')) {
        return jsonError('Përgjigjja nga burimi nuk është playlist HLS', 502);
      }

      const proxyBase = `${requestUrl.origin}/api/proxy?url=`;
      const rewritten = rewritePlaylist(playlist, finalUrl.href, proxyBase);

      return new Response(rewritten, {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'public, max-age=10, s-maxage=10'
        })
      });
    }

    // Stream-on segmentet pa i ngarkuar të gjitha në memorie.
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
      headers: corsHeaders({
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      })
    });
  }
}
