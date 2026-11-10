// api/stream.js
import { getBrowser } from '../lib/puppeteer.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
  memory: 1024
};

const CINESRC_ORIGIN = 'https://cinesrc.st';
const ALLOWED_STREAM_HOSTS = ['cinesrc.st', 'bright67.online'];
const NAVIGATION_TIMEOUT_MS = 9000;
const STREAM_WAIT_TIMEOUT_MS = 12000;

function isAllowedStreamUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ALLOWED_STREAM_HOSTS.some((host) =>
        url.hostname === host || url.hostname.endsWith(`.${host}`)
      );
  } catch {
    return false;
  }
}

function encodeProxySession(cookies) {
  const allowedDomains = new Set(['cinesrc.st', 'bright67.online']);
  const entries = (Array.isArray(cookies) ? cookies : [])
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: String(cookie.domain || '').replace(/^\\./, '').toLowerCase(),
      path: cookie.path || '/',
      secure: cookie.secure !== false
    }))
    .filter((cookie) =>
      typeof cookie.name === 'string' &&
      typeof cookie.value === 'string' &&
      cookie.path.startsWith('/') &&
      [...allowedDomains].some((domain) =>
        cookie.domain === domain || cookie.domain.endsWith('.' + domain)
      )
    )
    .slice(-40);

  if (!entries.length) return '';
  const token = Buffer.from(JSON.stringify(entries), 'utf8').toString('base64url');
  return token.length <= 8000 ? token : '';
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return { host: url.hostname, path: url.pathname };
  } catch {
    return null;
  }
}

function positiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} duhet të jetë numër pozitiv`);
  }
  return parsed;
}

function parseMasterPlaylist(source, manifestUrl) {
  const lines = String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;

    const attributeText = line.slice(line.indexOf(':') + 1);
    const attributes = {};
    for (const match of attributeText.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi)) {
      attributes[match[1].toUpperCase()] = String(match[2] || '').replace(/^"|"$/g, '');
    }

    let variantPath = '';
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (candidate && !candidate.startsWith('#')) {
        variantPath = candidate;
        index = next;
        break;
      }
    }
    if (!variantPath) continue;

    let url;
    try {
      url = new URL(variantPath, manifestUrl).href;
    } catch {
      continue;
    }

    const resolution = String(attributes.RESOLUTION || '').match(/^(\d+)x(\d+)$/i);
    const width = resolution ? Number(resolution[1]) : null;
    const height = resolution ? Number(resolution[2]) : null;
    const bandwidth = Number(attributes.BANDWIDTH || 0);
    const label = attributes.NAME || (height ? String(height) + 'p' : 'Variant ' + (variants.length + 1));

    variants.push({ label, width, height, bandwidth, url });
  }

  return variants.sort((a, b) =>
    (Number(b.height || 0) - Number(a.height || 0)) ||
    (Number(b.bandwidth || 0) - Number(a.bandwidth || 0))
  );
}

function waitForM3U8(page, timeoutMs) {
  let timer;
  let candidateTimer;
  let candidate = null;
  let settled = false;
  const seenRequests = [];
  let lastRequestFailure = '';

  const safeResource = (value) => {
    try {
      const url = new URL(value);
      return url.hostname + url.pathname;
    } catch {
      return 'unknown';
    }
  };

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(candidateTimer);
      page.off('request', onRequest);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    const onRequest = (request) => {
      const url = request.url();
      if (!/\.m3u8(?:$|[?#])/i.test(url)) return;
      seenRequests.push(safeResource(url));
      if (seenRequests.length > 8) seenRequests.shift();
    };

    const onRequestFailed = (request) => {
      if (!/\.m3u8(?:$|[?#])/i.test(request.url())) return;
      lastRequestFailure = request.failure()?.errorText || 'M3U8 request failed';
    };

    const onResponse = (response) => {
      const url = response.url();
      const status = response.status();
      const headers = response.headers();
      const contentType = headers['content-type'] || '';
      const looksLikePlaylist =
        /\.m3u8(?:$|[?#])/i.test(url) ||
        /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);

      if (!looksLikePlaylist || status < 200 || status >= 300) return;
      if (!isAllowedStreamUrl(url)) return;

      // Record the URL immediately. Do not make successful discovery depend
      // on response.text(), which may stall on some CDN/streaming responses.
      const responseCandidate = {
        url,
        status,
        contentType: contentType || 'unknown',
        playlistType: 'unknown',
        qualities: []
      };

      if (!candidate) {
        candidate = responseCandidate;
        candidateTimer = setTimeout(() => finish(null, candidate), 2200);
      }

      void response.text().then((body) => {
        const qualities = parseMasterPlaylist(body, url);
        const parsed = {
          url,
          status,
          contentType: contentType || 'unknown',
          playlistType: qualities.length ? 'master' : 'media',
          qualities
        };

        if (qualities.length) {
          console.info('[CineSRC resolver] Master playlist detected', {
            resource: safeResource(url),
            variants: qualities.map((quality) => quality.label)
          });
          finish(null, parsed);
          return;
        }

        // Prefer a parsed media playlist over an unparsed candidate, but keep
        // listening briefly for the master playlist that normally arrives first.
        if (!candidate || candidate.playlistType === 'unknown') {
          candidate = parsed;
          clearTimeout(candidateTimer);
          candidateTimer = setTimeout(() => finish(null, candidate), 700);
        }
      }).catch((error) => {
        console.warn('[CineSRC resolver] Could not read M3U8 body; keeping detected URL', {
          resource: safeResource(url),
          message: error?.message || 'response body unavailable'
        });
      });
    };

    page.on('request', onRequest);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);

    timer = setTimeout(() => {
      if (candidate) {
        finish(null, candidate);
        return;
      }

      const diagnostic = seenRequests.length
        ? 'M3U8 requests started but no successful playlist response was received.'
        : 'CineSRC did not request an M3U8 playlist in the headless browser.';
      const suffix = [
        seenRequests.length ? 'Seen: ' + seenRequests.join(', ') : '',
        lastRequestFailure ? 'Last request error: ' + lastRequestFailure : ''
      ].filter(Boolean).join(' | ');

      finish(new Error(
        diagnostic + (suffix ? ' ' + suffix : '')
      ));
    }, timeoutMs);
  });
}


async function prepareCineSrcPage(browser) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 720 });
  await page.setCacheEnabled(false);

  // Wait until Puppeteer has attached the initial main frame.
  await page.evaluate(() => document.readyState);
  return page;
}

async function navigateCineSrc(page, targetUrl) {
  try {
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS
    });
    return { ok: true, retryWithNewPage: false };
  } catch (error) {
    const message = String(error?.message || error);
    const retryWithNewPage =
      /navigating frame was detached|requesting main frame too early|target closed|frame detached|attempted to use detached frame/i.test(message);

    console.warn('[CineSRC resolver] Navigation warning', message);
    return {
      ok: false,
      retryWithNewPage,
      error: message
    };
  }
}

async function resolveOnPage(page, targetUrl) {
  let streamFound = false;
  const streamPromise = waitForM3U8(page, STREAM_WAIT_TIMEOUT_MS)
    .then((stream) => {
      streamFound = true;
      return { stream };
    })
    .catch((error) => ({ streamError: error }));

  // The listener is active before navigation starts.
  const navigation = await navigateCineSrc(page, targetUrl);

  if (navigation.retryWithNewPage) {
    // Do not attempt to recover a detached Frame using the same Page object.
    const pending = await Promise.race([
      streamPromise,
      new Promise((resolve) => setTimeout(() => resolve({}), 200))
    ]);
    if (pending.stream) return { stream: pending.stream };
    return { retryWithNewPage: true, error: navigation.error };
  }

  if (!streamFound) {
    await triggerPlayback(page, () => streamFound);
  }

  const finalResult = await streamPromise;
  if (finalResult.streamError) {
    return {
      error: finalResult.streamError.message || 'M3U8 was not detected',
      retryWithNewPage: false
    };
  }
  return { stream: finalResult.stream };
}
async function triggerPlayback(page, isStreamFound = () => false) {
  const deadline = Date.now() + 7000;

  while (Date.now() < deadline && !isStreamFound()) {
    const frames = page.frames();

    await Promise.all(frames.map(async (frame) => {
      try {
        await frame.evaluate(() => {
          const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity || 1) > 0;
          };

          const video = document.querySelector('video');
          if (video) {
            video.muted = true;
            video.autoplay = true;
            if (video.paused) {
              const play = video.play();
              if (play && typeof play.catch === 'function') play.catch(() => {});
            }
          }

          const candidates = Array.from(document.querySelectorAll(
            'button, [role="button"], [aria-label], [title], ' +
            '[class*="play"], [id*="play"], .vjs-big-play-button, ' +
            '.plyr__control--overlaid'
          ));

          const playControl = candidates.find((element) => {
            if (!visible(element)) return false;
            const label = [
              element.innerText,
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              typeof element.className === 'string' ? element.className : '',
              element.id || ''
            ].filter(Boolean).join(' ').toLowerCase();

            if (!/\b(play|watch|start|luaj|playbtn|play-button)\b/.test(label)) return false;
            if (/\b(pause|trailer|skip|playlist)\b/.test(label)) return false;
            return true;
          });

          if (playControl) playControl.click();
        });
      } catch {
        // Frames may still be loading or may detach while CineSRC initializes.
      }
    }));

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { id, type = 'movie', season, episode } = req.query;

  let tmdbId;
  let seasonNumber;
  let episodeNumber;

  try {
    tmdbId = positiveInteger(id, 'TMDB ID');
    seasonNumber = positiveInteger(season, 'Season');
    episodeNumber = positiveInteger(episode, 'Episode');
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  if (!tmdbId) {
    return res.status(400).json({ success: false, error: 'Mungon TMDB ID' });
  }

  if (type !== 'movie' && type !== 'tv') {
    return res.status(400).json({ success: false, error: 'Type duhet të jetë movie ose tv' });
  }

  if (type === 'tv' && (!seasonNumber || !episodeNumber)) {
    return res.status(400).json({
      success: false,
      error: 'Për serialet kërkohen season dhe episode'
    });
  }

  if (type === 'movie' && (seasonNumber || episodeNumber)) {
    return res.status(400).json({
      success: false,
      error: 'Season dhe episode nuk përdoren për filma'
    });
  }

  // Tokenët e playlist-it mund të jenë jetëshkurtër. Mos cache-o përgjigjen.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vary', 'Origin');

  const path = type === 'movie'
    ? `/embed/movie/${tmdbId}`
    : `/embed/tv/${tmdbId}?s=${seasonNumber}&e=${episodeNumber}`;
  // Use the exact embed URL that was proven to resolve on the laptop.
  // Do not append undocumented player query parameters; they can change
  // CineSRC's initialization path and prevent its HLS request from starting.
  const targetUrl = new URL(path, CINESRC_ORIGIN).href;

  let browser;
  let page;

  try {
    browser = await getBrowser();

    let stream = null;
    let lastResolveError = 'CineSRC did not return an M3U8 playlist.';
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts && !stream; attempt += 1) {
      page = await prepareCineSrcPage(browser);
      console.info('[CineSRC resolver] Starting page attempt', { attempt, tmdbId, type });

      const attemptResult = await resolveOnPage(page, targetUrl);
      stream = attemptResult.stream || null;
      lastResolveError = attemptResult.error || lastResolveError;

      if (stream) break;

      const needsFreshPage = attemptResult.retryWithNewPage;
      if (attempt < maxAttempts && (needsFreshPage || attemptResult.error)) {
        console.warn('[CineSRC resolver] Retrying with a fresh Page', {
          attempt,
          reason: lastResolveError
        });
        if (page && !page.isClosed()) {
          try { await page.close(); } catch {}
        }
        page = null;
        continue;
      }
    }

    if (!stream) {
      throw new Error(lastResolveError);
    }

    if (!isAllowedStreamUrl(stream.url)) {
      throw new Error('URL e stream-it nuk kaloi kontrollin e host-it.');
    }

    // The direct master URL is returned unchanged. Some CineSRC/CDN sessions
    // also require browser cookies and the original Referer for child playlists
    // and media segments, so provide a compatible proxy URL as a fallback only.
    const pageReferrer = type === 'movie'
      ? `${CINESRC_ORIGIN}/embed/movie/${tmdbId}`
      : `${CINESRC_ORIGIN}/embed/tv/${tmdbId}?s=${seasonNumber}&e=${episodeNumber}`;

    let proxySession = '';
    try {
      proxySession = encodeProxySession(await page.browserContext().cookies());
    } catch (cookieError) {
      console.warn('CineSRC browser cookie capture failed:', cookieError.message);
    }

    const sessionParam = proxySession
      ? '&session=' + encodeURIComponent(proxySession)
      : '';
    const streamUrl = '/api/proxy?ref=' + encodeURIComponent(pageReferrer) +
      sessionParam + '&url=' + encodeURIComponent(stream.url);

    return res.status(200).json({
      success: true,
      source: 'cinesrc',
      format: 'hls',
      masterUrl: stream.url,
      // Used only if the direct master is rejected by the CDN/session policy.
      streamUrl,
      playlistType: stream.playlistType,
      qualities: stream.qualities,
      detected: {
        status: stream.status,
        contentType: stream.contentType,
        url: safeUrl(stream.url)
      }
    });
  } catch (error) {
    console.error('CineSRC Puppeteer resolver error:', error.message);
    return res.status(502).json({
      success: false,
      source: 'cinesrc',
      error: error.message
    });
  } finally {
    if (page && !page.isClosed()) {
      try { await page.close(); } catch {}
    }
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
