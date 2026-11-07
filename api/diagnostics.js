// api/diagnostics.js
// Diagnostikon HLS manifestin, init segmentin, segmentin e pare dhe titrat.
// Pranon vetem HTTPS URL nga host-et e njohura te CineSRC/Nebula.

export const config = { runtime: 'edge' };

const ALLOWED_HOSTS = [
  'cinesrc.st',
  'bright67.online'
];

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ALLOWED_HOSTS.some((host) =>
        url.hostname === host || url.hostname.endsWith(`.${host}`)
      );
  } catch {
    return false;
  }
}

function safeUrlInfo(value) {
  try {
    const url = new URL(value);
    return { host: url.hostname, path: url.pathname };
  } catch {
    return null;
  }
}

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra
  };
}

async function fetchWithTimeout(url, headers = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://cinesrc.st/',
        'Origin': 'https://cinesrc.st',
        'Accept': '*/*',
        ...headers
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!isAllowedUrl(response.url || url)) {
      try { await response.body?.cancel(); } catch {}
      throw new Error('Redirect jashtë host-eve të lejuara');
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function readTextLimited(response, maxBytes = 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      const part = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(part);
      total += part.byteLength;
      if (part.byteLength < value.byteLength) break;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function inspectResource(url, label) {
  if (!isAllowedUrl(url)) {
    return { label, ok: false, error: 'URL ose host i palejuar', url: safeUrlInfo(url) };
  }

  try {
    const response = await fetchWithTimeout(url, { Range: 'bytes=0-2047' });
    const contentType = response.headers.get('content-type') || 'unknown';
    const status = response.status;
    const prefix = await readTextLimited(response, 2048);
    const httpOk = response.ok || status === 206;
    const isFmp4 = prefix.includes('ftyp') || prefix.includes('moof') || prefix.includes('mdat');
    const isSubtitle = /WEBVTT|-->/.test(prefix) || /^\\s*1\\s*\\r?\\n\\d{2}:\\d{2}/.test(prefix);
    const ok = httpOk && (label !== 'subtitle' || isSubtitle);

    return {
      label,
      ok,
      status,
      contentType,
      rangeSupported: status === 206,
      bytesInspected: new TextEncoder().encode(prefix).byteLength,
      signature: label === 'init' || label === 'segment'
        ? (isFmp4 ? 'fMP4 signature detected' : 'fMP4 signature not confirmed')
        : label === 'subtitle'
          ? (isSubtitle ? 'SRT/VTT text detected' : 'subtitle format not confirmed')
          : undefined,
      url: safeUrlInfo(response.url || url)
    };
  } catch (error) {
    return { label, ok: false, error: error.message, url: safeUrlInfo(url) };
  }
}

function parseAttribute(line, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`(?:^|,)\\s*${escaped}="([^"]+)"`, 'i'));
  return match?.[1] || null;
}

function parsePlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const mapLine = lines.find((line) => line.trim().startsWith('#EXT-X-MAP:'));
  const mapUri = mapLine ? parseAttribute(mapLine.trim().slice('#EXT-X-MAP:'.length), 'URI') : null;

  const streamIndex = lines.findIndex((line) => line.trim().startsWith('#EXT-X-STREAM-INF:'));
  let variantUri = null;
  if (streamIndex >= 0) {
    for (let i = streamIndex + 1; i < lines.length; i++) {
      const value = lines[i].trim();
      if (value && !value.startsWith('#')) {
        variantUri = value;
        break;
      }
    }
  }

  const firstSegment = lines.map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || null;

  return {
    isMaster: Boolean(variantUri),
    variantUrl: variantUri ? new URL(variantUri, baseUrl).href : null,
    initUrl: mapUri ? new URL(mapUri, baseUrl).href : null,
    firstSegmentUrl: !variantUri && firstSegment ? new URL(firstSegment, baseUrl).href : null,
    hasEndList: lines.some((line) => line.trim() === '#EXT-X-ENDLIST'),
    segmentCount: lines.filter((line) => {
      const value = line.trim();
      return value && !value.startsWith('#');
    }).length
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: cors({ 'Content-Type': 'application/json' })
    });
  }

  const requestUrl = new URL(req.url);
  const manifestUrl = requestUrl.searchParams.get('url');
  const subtitleUrl = requestUrl.searchParams.get('subtitle');

  if (!manifestUrl) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Mungon parametri url',
      usage: '/api/diagnostics?url=<M3U8_URL>&subtitle=<SRT_OR_VTT_URL>'
    }), { status: 400, headers: cors({ 'Content-Type': 'application/json' }) });
  }

  if (!isAllowedUrl(manifestUrl)) {
    return new Response(JSON.stringify({ success: false, error: 'Lejohen vetem URL HTTPS nga cinesrc.st dhe bright67.online' }), {
      status: 403,
      headers: cors({ 'Content-Type': 'application/json' })
    });
  }

  try {
    const manifestResponse = await fetchWithTimeout(manifestUrl);
    const manifestStatus = manifestResponse.status;
    const manifestType = manifestResponse.headers.get('content-type') || 'unknown';

    if (!manifestResponse.ok) {
      try { await manifestResponse.body?.cancel(); } catch {}
      return new Response(JSON.stringify({
        success: false,
        stage: 'manifest',
        status: manifestStatus,
        contentType: manifestType,
        message: 'Manifesti nuk u mor me sukses. Mund te kete skaduar URL/tokeni.'
      }), { status: 200, headers: cors({ 'Content-Type': 'application/json' }) });
    }

    const manifestText = await readTextLimited(manifestResponse, 1024 * 1024);
    if (!manifestText.startsWith('#EXTM3U')) {
      return new Response(JSON.stringify({
        success: false,
        stage: 'manifest',
        status: manifestStatus,
        contentType: manifestType,
        message: 'Përgjigjja nuk duket si playlist HLS.',
        preview: manifestText.slice(0, 160)
      }), { status: 200, headers: cors({ 'Content-Type': 'application/json' }) });
    }

    const parsed = parsePlaylist(manifestText, manifestResponse.url || manifestUrl);
    let mediaParsed = parsed;
    let variantCheck = null;

    if (parsed.isMaster && parsed.variantUrl) {
      if (!isAllowedUrl(parsed.variantUrl)) {
        throw new Error('Variant playlist jashtë host-eve të lejuara');
      }
      const variantResponse = await fetchWithTimeout(parsed.variantUrl);
      const variantText = await readTextLimited(variantResponse, 1024 * 1024);
      variantCheck = {
        ok: variantResponse.ok && variantText.startsWith('#EXTM3U'),
        status: variantResponse.status,
        contentType: variantResponse.headers.get('content-type') || 'unknown'
      };
      if (variantResponse.ok && variantText.startsWith('#EXTM3U')) {
        mediaParsed = parsePlaylist(variantText, mediaPlaylistUrl);
      }
    }

    const checks = [];
    if (mediaParsed.initUrl) checks.push(await inspectResource(mediaParsed.initUrl, 'init'));
    if (mediaParsed.firstSegmentUrl) checks.push(await inspectResource(mediaParsed.firstSegmentUrl, 'segment'));

    let subtitleCheck = null;
    if (subtitleUrl) {
      if (!isAllowedUrl(subtitleUrl)) {
        subtitleCheck = { ok: false, error: 'Subtitle URL nga host i palejuar' };
      } else {
        subtitleCheck = await inspectResource(subtitleUrl, 'subtitle');
      }
    }

    const resourcesOk = checks.every((item) => item.ok);
    const success = manifestText.startsWith('#EXTM3U') &&
      (!parsed.isMaster || variantCheck?.ok) &&
      resourcesOk &&
      (!subtitleUrl || subtitleCheck?.ok);

    return new Response(JSON.stringify({
      success,
      manifest: {
        ok: true,
        status: manifestStatus,
        contentType: manifestType,
        bytes: new TextEncoder().encode(manifestText).byteLength,
        isMaster: parsed.isMaster,
        segmentCount: mediaParsed.segmentCount,
        hasEndList: mediaParsed.hasEndList,
        url: safeUrlInfo(manifestResponse.url || manifestUrl)
      },
      variant: variantCheck,
      resources: checks,
      subtitle: subtitleCheck,
      note: 'URL-të e plota dhe tokenët nuk kthehen në përgjigje.'
    }), {
      status: 200,
      headers: cors({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 502,
      headers: cors({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    });
  }
}
