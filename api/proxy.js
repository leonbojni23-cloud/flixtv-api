// api/proxy.js
import { rewritePlaylist } from '../lib/m3u8.js';

export const config = { runtime: 'edge' };

const DEFAULT_ALLOWED_HOSTS = ['cinesrc.st', 'bright67.online'];
const MAX_REDIRECTS = 8;
const SESSION_COOKIE = 'cinesrc_proxy_session';

function decodeSession(value, jar) {
  if (!value || typeof value !== 'string' || value.length > 8000) return;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const entries = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(entries)) return;

    for (const item of entries) {
      if (!item || typeof item.name !== 'string' ||
          typeof item.value !== 'string' ||
          typeof item.domain !== 'string' ||
          typeof item.path !== 'string') continue;

      // Chromium stores some cookies with a leading dot in the Domain field.
      // Normalize it before matching hosts or constructing the Cookie header.
      const domain = item.domain.replace(/^\./, '').toLowerCase();
      if (!isAllowedHost(domain) || !item.path.startsWith('/')) continue;
      jar.set(item.name + '@' + domain + item.path, {
        name: item.name,
        value: item.value,
        domain,
        path: item.path,
        secure: item.secure !== false
      });
    }
  } catch {
    // Një token sesioni i pavlefshëm nuk duhet të prishë playback.
  }
}

function restoreSession(req, jar, urlSession) {
  const raw = req.headers.get('cookie') || '';
  const match = raw.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([^;]+)'));
  if (match) decodeSession(match[1], jar);
  // HLS clients and browsers do not always persist cross-origin cookies.
  // Carry the upstream cookie jar inside each rewritten proxy URL instead.
  decodeSession(urlSession, jar);
}

function encodeSession(jar) {
  const entries = [...jar.values()].slice(-30);
  if (!entries.length) return '';
  const bytes = new TextEncoder().encode(JSON.stringify(entries));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).split('+').join('-').split('/').join('_').replace(/=+$/g, '');
}

function sessionCookie(jar) {
  const entries = [...jar.values()].slice(-30);
  if (!entries.length) {
    return SESSION_COOKIE + '=; Path=/api/proxy; Max-Age=0; HttpOnly; Secure; SameSite=None';
  }

  const bytes = new TextEncoder().encode(JSON.stringify(entries));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const value = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (value.length > 3800) {
    return SESSION_COOKIE + '=; Path=/api/proxy; Max-Age=0; HttpOnly; Secure; SameSite=None';
  }
  return SESSION_COOKIE + '=' + value + '; Path=/api/proxy; Max-Age=1800; HttpOnly; Secure; SameSite=None';
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

function decodeProxyHeaders(value) {
  if (!value || typeof value !== 'string' || value.length > 5000) return {};
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result = {};
    const clean = (input, maxLength) => {
      if (typeof input !== 'string' || input.length > maxLength || /[\\r\\n]/.test(input)) return '';
      return input.trim();
    };

    const userAgent = clean(parsed.userAgent, 512);
    const accept = clean(parsed.accept, 512);
    const acceptLanguage = clean(parsed.acceptLanguage, 256);
    if (userAgent) result.userAgent = userAgent;
    if (accept) result.accept = accept;
    if (acceptLanguage) result.acceptLanguage = acceptLanguage;

    try {
      const referer = new URL(clean(parsed.referer, 2048));
      if (referer.protocol === 'https:' &&
          (referer.hostname === 'cinesrc.st' || referer.hostname.endsWith('.cinesrc.st'))) {
        result.referer = referer.href;
      }
    } catch {}

    try {
      const origin = new URL(clean(parsed.origin, 512));
      if (origin.protocol === 'https:' &&
          (origin.hostname === 'cinesrc.st' || origin.hostname.endsWith('.cinesrc.st'))) {
        result.origin = origin.origin;
      }
    } catch {}

    return result;
  } catch {
    return {};
  }
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

const ALLOWED_ORIGINS = new Set([
  'https://flixtv-atelier-ecommerce.vercel.app',
  'https://flixtv-snowy.vercel.app',
  'https://flixtv-git-main-atelier-ecommerce.vercel.app'
]);

function corsHeaders(extra = {}, req = null) {
  const origin = req?.headers?.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : 'https://flixtv-atelier-ecommerce.vercel.app';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Vary': 'Origin',
    ...extra
  };
}

function jsonError(message, status, details = {}, req = null) {
  return new Response(JSON.stringify({ success: false, error: message, ...details }), {
    status,
    headers: corsHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, req)
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

async function sniffFmp4Segment(response, targetUrl) {
  let responseBody = response.body;
  let contentType = response.headers.get('content-type') || 'application/octet-stream';

  // CineSRC disguises fragmented MP4 media fragments with a .jpg suffix.
  // The bytes are still ISO-BMFF (styp/moof/sidx), so expose the correct MIME
  // type to native HLS clients instead of forwarding image/jpeg.
  if (!/^image\//i.test(contentType) || !responseBody) {
    return { body: responseBody, contentType };
  }

  const reader = responseBody.getReader();
  const first = await reader.read();
  if (first.done || !first.value) {
    return { body: null, contentType };
  }

  const prefix = String.fromCharCode(...first.value.slice(0, 64));
  if (!/(?:ftyp|styp|moof|sidx)/.test(prefix)) {
    let firstChunk = first.value;
    const body = new ReadableStream({
      async pull(controller) {
        if (firstChunk) {
          controller.enqueue(firstChunk);
          firstChunk = null;
          return;
        }
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel(reason) { return reader.cancel(reason); }
    });
    return { body, contentType };
  }

  let firstChunk = first.value;
  const body = new ReadableStream({
    async pull(controller) {
      if (firstChunk) {
        controller.enqueue(firstChunk);
        firstChunk = null;
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) { return reader.cancel(reason); }
  });

  return { body, contentType: 'video/mp4' };
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
    return new Response(null, { status: 204, headers: corsHeaders({}, req) });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders({ Allow: 'GET, HEAD, OPTIONS' }, req)
    });
  }

  const requestUrl = new URL(req.url);
  const target = requestUrl.searchParams.get('url');
  if (!target) return jsonError('Mungon parametri url', 400, {}, req);

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonError('URL e pavlefshme', 400, {}, req);
  }

  if (targetUrl.protocol !== 'https:' || !isAllowedHost(targetUrl.hostname.toLowerCase())) {
    return jsonError('Host-i i burimit nuk lejohet', 403, {}, req);
  }

  const jar = new Map();
  restoreSession(req, jar, requestUrl.searchParams.get('session'));
  const capturedHeaders = decodeProxyHeaders(requestUrl.searchParams.get('headers'));

  // Prefer the exact Referer/Origin observed in CineSRC's own CDN request.
  let pageReferrer = 'https://cinesrc.st/';
  const requestedReferrer = capturedHeaders.referer || requestUrl.searchParams.get('ref');
  if (requestedReferrer) {
    try {
      const parsedReferrer = new URL(requestedReferrer);
      if (parsedReferrer.protocol === 'https:' &&
          (parsedReferrer.hostname === 'cinesrc.st' || parsedReferrer.hostname.endsWith('.cinesrc.st'))) {
        pageReferrer = parsedReferrer.href;
      }
    } catch {}
  }

  try {
    const upstreamHeaders = new Headers({
      'User-Agent': capturedHeaders.userAgent ||
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': capturedHeaders.accept || '*/*',
      'Accept-Language': capturedHeaders.acceptLanguage || 'en-US,en;q=0.9',
      'Referer': pageReferrer,
      'Origin': capturedHeaders.origin || 'https://cinesrc.st'
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
      const contentType = response.headers.get('content-type') || 'unknown';
      let upstreamBody = '';
      try { upstreamBody = (await response.text()).slice(0, 400); } catch {}
      console.error('[CineSRC Proxy] Upstream rejected resource', {
        status: response.status,
        resource: safeResource(finalUrl),
        contentType,
        upstreamBodyLength: upstreamBody.length,
        upstreamBodyPreview: upstreamBody.replace(/[\\r\\n\\t]+/g, ' ').slice(0, 160),
        sessionCookieCount: jar.size,
        sessionCookieDomains: [...new Set([...jar.values()].map((cookie) => cookie.domain))],
        refererHost: (() => { try { return new URL(pageReferrer).host; } catch { return 'unknown'; } })()
      });
      const extra = contentRange ? { 'Content-Range': contentRange } : {};
      return withSessionCookie(jsonError('Burimi refuzoi kërkesën e videos.', 502, {
        upstreamStatus: response.status,
        resource: safeResource(finalUrl),
        upstreamContentType: contentType,
        upstreamBodyLength: upstreamBody.length
      }, req), jar);
    }

    const upstreamContentType = response.headers.get('content-type') || 'application/octet-stream';
    const playlistResponse = isPlaylist(finalUrl, upstreamContentType);

    if (isLikelySegment(targetUrl.href) && playlistResponse) {
      try { await response.body?.cancel(); } catch {}
      return withSessionCookie(jsonError(
        'Kërkesa për segment video mori playlist M3U8 nga CDN. Mund të ketë skaduar URL-ja e segmentit.',
        502,
        { resource: safeResource(finalUrl), upstreamStatus: response.status }, req
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
          }, req)
        }), jar);
      }

      const playlist = await response.text();
      if (!playlist.trimStart().startsWith('#EXTM3U')) {
        return withSessionCookie(jsonError('CDN deklaroi M3U8, por përmbajtja nuk është playlist HLS.', 502, {
          resource: safeResource(finalUrl)
        }, req), jar);
      }

      const session = encodeSession(jar);
      const headerToken = requestUrl.searchParams.get('headers') || '';
      const proxyBase = requestUrl.origin + '/api/proxy?ref=' + encodeURIComponent(pageReferrer) +
        (session ? '&session=' + encodeURIComponent(session) : '') +
        (headerToken ? '&headers=' + encodeURIComponent(headerToken) : '') + '&url=';
      const rewritten = rewritePlaylist(playlist, finalUrl, proxyBase);
      return withSessionCookie(new Response(rewritten, {
        status: 200,
        headers: corsHeaders({
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store'
        }, req)
      }), jar);
    }

    const normalizedSegment = await sniffFmp4Segment(response, targetUrl.href);
    const responseHeaders = corsHeaders({
      'Content-Type': normalizedSegment.contentType,
      'Cache-Control': 'no-store',
      'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length'
    }, req);
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');
    // Do not forward Content-Length for streamed bodies. Edge fetch may decode
    // upstream transfer encoding, which makes the original length stale and can
    // cause Chromium ORB/media loaders to reject otherwise valid 206 responses.
    if (contentRange) responseHeaders['Content-Range'] = contentRange;
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges;

    return withSessionCookie(new Response(req.method === 'HEAD' ? null : normalizedSegment.body, {
      status: response.status,
      headers: responseHeaders
    }), jar);
  } catch (error) {
    console.error('[CineSRC Proxy]', error.message);
    return withSessionCookie(jsonError('Gabim në Proxy: ' + error.message, 502, {}, req), jar);
  }
}
