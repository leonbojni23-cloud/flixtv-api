// api/proxy.js
import { rewritePlaylist } from '../lib/m3u8.js';

export const config = { runtime: 'edge' };

const DEFAULT_ALLOWED_HOSTS = ['cinesrc.st', 'bright67.online'];
const MAX_REDIRECTS = 8;
const SESSION_COOKIE = 'cinesrc_proxy_session';

function restoreSession(req, jar) {
  const raw = req.headers.get('cookie') || '';
  const match = raw.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([^;]+)'));
  if (!match) return;

  try {
    const binary = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const entries = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(entries)) return;

    for (const item of entries) {
      if (!item || typeof item.name !== 'string' ||
          typeof item.value !== 'string' ||
          typeof item.domain !== 'string' ||
          typeof item.path !== 'string') continue;
      if (!isAllowedHost(item.domain) || !item.path.startsWith('/')) continue;
      jar.set(item.name + '@' + item.domain + item.path, {
        name: item.name,
        value: item.value,
        domain: item.domain,
        path: item.path,
        secure: item.secure !== false
      });
    }
  } catch {
    // Një cookie sesioni e pavlefshme nuk duhet të prishë playback.
  }
}

function sessionCookie(jar) {
  const entries = [...jar.values()].slice(-30);
  if (!entries.length) {
    return SESSION_COOKIE + '=; Path=/api/proxy; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
  }

  const bytes = new TextEncoder().encode(JSON.stringify(entries));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const value = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (value.length > 3800) {
    return SESSION_COOKIE + '=; Path=/api/proxy; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
  }
  return SESSION_COOKIE + '=' + value + '; Path=/api/proxy; Max-Age=1800; HttpOnly; Secure; SameSite=Lax';
}

function withSessionCookie(response, jar) {
  const headers = new Headers(response.headers);
  headers.set('Set-Cookie', sessionCookie(jar));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

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

function jsonError(message, status, details = {}) {
  return new Response(JSON.stringify({ success: false, error: message, ...details }), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
  });
}

function safeResource(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return 'invalid-url';
  }
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function storeCookies(headers, responseUrl, jar) {
  const responseHost = new URL(responseUrl).hostname.toLowerCase();
  for (const rawCookie of getSetCookies(headers)) {
    const firstPart = rawCookie.split(';', 1)[0];
    const separator = firstPart.indexOf('=');
    if (separator <= 0) continue;

    const name = firstPart.slice(0, separator).trim();
    const value = firstPart.slice(separator + 1).trim();
    const attributes = rawCookie.split(';').slice(1);
    let domain = responseHost;
    let path = '/';
    let secure = false;

    for (const attribute of attributes) {
      const [rawName, ...rawValue] = attribute.trim().split('=');
      const attrName = rawName.toLowerCase();
      const attrValue = rawValue.join('=').trim();
      if (attrName === 'domain' && attrValue) domain = attrValue.replace(/^\./, '').toLowerCase();
      if (attrName === 'path' && attrValue.startsWith('/')) path = attrValue;
      if (attrName === 'secure') secure = true;
    }

    if (responseHost !== domain && !responseHost.endsWith('.' + domain)) continue;
    jar.set(name + '@' + domain + path, { name, value, domain, path, secure });
  }
}

function cookieHeader(url, jar) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const cookies = [];

  for (const cookie of jar.values()) {
    const domainMatches = host === cookie.domain || host.endsWith('.' + cookie.domain);
    const pathMatches = parsed.pathname.startsWith(cookie.path);
    if (domainMatches && pathMatches && (!cookie.secure || parsed.protocol === 'https:')) {
      cookies.push(cookie.name + '=' + cookie.value);
    }
  }

  return cookies.join('; ');
}

function isPlaylist(url, contentType = '') {
  return /\.m3u8(?:$|[?#])/i.test(url) ||
    /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);
}

function isLikelySegment(url) {
  try {
    return /\.(?:ts|m4s|mp4|m4v|m4a|jpg|jpeg|png|webp)(?:$|[?#])/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

async function fetchFollowingRedirects(initialUrl, method, headers, jar) {
  let currentUrl = initialUrl;
  const visited = new Set();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname.toLowerCase())) {
      throw new Error('Redirect-i shkoi te një host që nuk lejohet.');
    }

    const normalized = parsed.href;
    if (visited.has(normalized)) {
      throw new Error('CDN ktheu një cikël ridrejtimesh te i njëjti resource: ' + safeResource(normalized));
    }
    visited.add(normalized);

    const requestHeaders = new Headers(headers);
    const cookies = cookieHeader(normalized, jar);
    if (cookies) requestHeaders.set('Cookie', cookies);

    const response = await fetch(normalized, {
      method,
      headers: requestHeaders,
      redirect: 'manual'
    });

    storeCookies(response.headers, normalized, jar);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: normalized };
    }

    const location = response.headers.get('location');
    try { await response.body?.cancel(); } catch {}

    if (!location) {
      throw new Error('CDN ktheu status ridrejtimi pa Location (' + response.status + ').');
    }
    if (hop === MAX_REDIRECTS) {
      throw new Error('CDN kaloi kufirin prej ' + MAX_REDIRECTS + ' ridrejtimesh.');
    }

    const nextUrl = new URL(location, normalized);
    if (nextUrl.protocol !== 'https:' || !isAllowedHost(nextUrl.hostname.toLowerCase())) {
      throw new Error('Redirect-i shkoi te një host që nuk lejohet.');
    }

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== 'HEAD')) {
      method = 'GET';
    }
    currentUrl = nextUrl.href;
  }

  throw new Error('Nuk u arrit të ndiqet ridrejtimi i CDN-së.');
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

  const jar = new Map();
  restoreSession(req, jar);

  try {
    const upstreamHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': targetUrl.hostname.toLowerCase().endsWith('bright67.online')
        ? 'https://cinesrc.st/'
        : 'https://cinesrc.st/',
      'Origin': 'https://cinesrc.st'
    });

    const range = req.headers.get('range');
    if (range) upstreamHeaders.set('Range', range);

    const { response, finalUrl } = await fetchFollowingRedirects(
      targetUrl.href,
      req.method,
      upstreamHeaders,
      jar
    );

    if (!response.ok && response.status !== 206) {
      const contentRange = response.headers.get('content-range');
      const extra = contentRange ? { 'Content-Range': contentRange } : {};
      try { await response.body?.cancel(); } catch {}
      return withSessionCookie(new Response('Burimi ktheu statusin ' + response.status, {
        status: response.status,
        headers: corsHeaders({ 'Cache-Control': 'no-store', ...extra })
      }), jar);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const playlistResponse = isPlaylist(finalUrl, contentType);

    if (isLikelySegment(targetUrl.href) && playlistResponse) {
      try { await response.body?.cancel(); } catch {}
      return withSessionCookie(jsonError(
        'Kërkesa për segment video mori playlist M3U8 nga CDN. Mund të ketë skaduar URL-ja e segmentit.',
        502,
        { resource: safeResource(finalUrl), upstreamStatus: response.status }
      ), jar);
    }

    if (playlistResponse) {
      if (req.method === 'HEAD') {
        try { await response.body?.cancel(); } catch {}
        return withSessionCookie(new Response(null, {
          status: response.status,
          headers: corsHeaders({
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
            'Cache-Control': 'no-store'
          })
        }), jar);
      }

      const playlist = await response.text();
      if (!playlist.trimStart().startsWith('#EXTM3U')) {
        return withSessionCookie(jsonError('CDN deklaroi M3U8, por përmbajtja nuk është playlist HLS.', 502, {
          resource: safeResource(finalUrl)
        }), jar);
      }

      const proxyBase = requestUrl.origin + '/api/proxy?url=';
      const rewritten = rewritePlaylist(playlist, finalUrl, proxyBase);
      return withSessionCookie(new Response(rewritten, {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store'
        })
      }), jar);
    }

    const responseHeaders = corsHeaders({
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    const contentLength = response.headers.get('content-length');
    if (contentRange) responseHeaders['Content-Range'] = contentRange;
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges;
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    return withSessionCookie(new Response(req.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: responseHeaders
    }), jar);
  } catch (error) {
    console.error('[CineSRC Proxy]', error.message);
    return withSessionCookie(jsonError('Gabim në Proxy: ' + error.message, 502), jar);
  }
}
