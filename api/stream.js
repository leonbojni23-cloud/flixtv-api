// api/stream.js
import { getBrowser, resetBrowser } from '../lib/puppeteer.js';

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
  let settleTimer;
  let candidate = null;
  let settled = false;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(settleTimer);
      page.off('response', onResponse);
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    const onResponse = (response) => {
      void (async () => {
        const url = response.url();
        const status = response.status();
        const headers = response.headers();
        const contentType = headers['content-type'] || '';
        const looksLikePlaylist =
          /\.m3u8(?:$|[?#])/i.test(url) ||
          /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);

        if (!looksLikePlaylist || status < 200 || status >= 300) return;
        if (!isAllowedStreamUrl(url)) return;

        const body = await response.text().catch(() => '');
        const qualities = parseMasterPlaylist(body, url);
        const result = {
          url,
          status,
          contentType: contentType || 'unknown',
          playlistType: qualities.length ? 'master' : 'media',
          qualities
        };

        if (qualities.length) {
          finish(null, result);
          return;
        }

        if (!candidate) {
          candidate = result;
          settleTimer = setTimeout(() => finish(null, candidate), 1400);
        }
      })().catch(() => {});
    };

    page.on('response', onResponse);
    timer = setTimeout(() => {
      if (candidate) finish(null, candidate);
      else finish(new Error('Timeout: player-i nuk ngarkoi një M3U8 brenda afatit.'));
    }, timeoutMs);
  });
}


async function triggerPlayback(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await Promise.all(page.frames().map(async (frame) => {
      try {
        await frame.evaluate(() => {
          const video = document.querySelector('video');
          if (video) {
            video.muted = true;
            const play = video.play();
            if (play && typeof play.catch === 'function') play.catch(() => {});
          }

          const buttons = Array.from(document.querySelectorAll(
            'button, [role="button"], .vjs-big-play-button, .plyr__control--overlaid'
          ));
          const playButton = buttons.find((element) => {
            const label = [
              element.innerText,
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              typeof element.className === 'string' ? element.className : ''
            ].filter(Boolean).join(' ').toLowerCase();

            if (!/\b(play|watch|start|luaj)\b/.test(label)) return false;
            if (/\b(pause|trailer|skip)\b/.test(label)) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          if (playButton) playButton.click();
        });
      } catch {
        // A frame can still be loading or disappear while the player starts.
      }
    }));

    await new Promise((resolve) => setTimeout(resolve, 180));
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
  const target = new URL(path, CINESRC_ORIGIN);
  target.searchParams.set('autoplay', 'true');
  target.searchParams.set('muted', 'true');
  target.searchParams.set('controls', 'true');
  target.searchParams.set('autonext', 'false');
  const targetUrl = target.href;

  let browser;
  let context;
  let page;

  try {
    // A warm serverless instance can retain a stale Chromium socket after
    // Vercel freezes/thaws it. Retry context creation once with a fresh process.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        browser = await getBrowser();
        context = await browser.createBrowserContext();
        page = await context.newPage();
        break;
      } catch (browserError) {
        if (context) {
          try { await context.close(); } catch {}
        }
        context = null;
        page = null;
        resetBrowser(browser);
        browser = null;
        const retryable = /target closed|session closed|protocol error|browser.*disconnected/i.test(
          String(browserError && browserError.message || browserError)
        );
        if (!retryable || attempt === 1) throw browserError;
        console.warn('Retrying CineSRC resolver with a fresh Chromium instance.');
      }
    }

    if (!page || !context) throw new Error('Chromium nuk krijoi dot një faqe të re.');
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );

    // Start listening before navigation. Return as soon as the master
    // playlist is observed; do not wait for the entire embed page to settle.
    const streamResult = waitForM3U8(page, STREAM_WAIT_TIMEOUT_MS)
      .then((stream) => ({ stream }))
      .catch((error) => ({ streamError: error }));

    const navigationResult = page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS
    }).then(() => ({ navigated: true })).catch((error) => {
      console.warn('CineSRC navigation warning:', error.message);
      return { navigationError: error.message };
    });

    const firstResult = await Promise.race([streamResult, navigationResult]);
    let stream = firstResult.stream;

    if (!stream) {
      // If autoplay did not issue the HLS request by DOMContentLoaded,
      // make one short, bounded attempt to start the embed's play control.
      await triggerPlayback(page);
      if (firstResult.streamError) throw firstResult.streamError;
      const finalResult = await streamResult;
      if (finalResult.streamError) throw finalResult.streamError;
      stream = finalResult.stream;
    }

    if (!isAllowedStreamUrl(stream.url)) {
      throw new Error('URL e stream-it nuk kaloi kontrollin e host-it.');
    }

    return res.status(200).json({
      success: true,
      source: 'cinesrc',
      format: 'hls',
      masterUrl: stream.url,
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
    if (context) {
      try { await context.close(); } catch {}
    }
  }
}
