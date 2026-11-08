// api/stream.js
import { getBrowser } from '../lib/puppeteer.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
  memory: 1024
};

const CINESRC_ORIGIN = 'https://cinesrc.st';
const ALLOWED_STREAM_HOSTS = ['cinesrc.st', 'bright67.online'];
const NAVIGATION_TIMEOUT_MS = 12000;
const STREAM_WAIT_TIMEOUT_MS = 18000;

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

function waitForM3U8(page, timeoutMs) {
  let timer;

  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      page.off('response', onResponse);
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

        cleanup();
        resolve({
          url,
          status,
          contentType: contentType || 'unknown'
        });
      })().catch(() => {
        // Një përgjigje e vetme e keqe nuk duhet të ndalojë përgjimin.
      });
    };

    page.on('response', onResponse);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout: player-i nuk ngarkoi një M3U8 brenda afatit.'));
    }, timeoutMs);
  });

  return promise;
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
  const targetUrl = new URL(path, CINESRC_ORIGIN).href;

  let browser;
  let page;

  try {
    browser = await getBrowser();
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );

    // Përgjimi fillon PARA navigimit që të mos humbasim manifestin e parë.
    const streamPromise = waitForM3U8(page, STREAM_WAIT_TIMEOUT_MS);

    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS
      });
    } catch (navigationError) {
      // Një navigim mund të përfundojë me timeout edhe kur player-i
      // ka nisur tashmë kërkesat. Lëmë përgjimin të vendosë rezultatin.
      console.warn('CineSRC navigation warning:', navigationError.message);
    }

    const stream = await streamPromise;

    if (!isAllowedStreamUrl(stream.url)) {
      throw new Error('URL e stream-it nuk kaloi kontrollin e host-it.');
    }

    const pageReferrer = type === 'movie'
      ? `${CINESRC_ORIGIN}/embed/movie/${tmdbId}`
      : `${CINESRC_ORIGIN}/embed/tv/${tmdbId}?s=${seasonNumber}&e=${episodeNumber}`;
    const streamUrl = `/api/proxy?ref=${encodeURIComponent(pageReferrer)}&url=${encodeURIComponent(stream.url)}`;

    return res.status(200).json({
      success: true,
      source: 'cinesrc',
      format: 'hls',
      streamUrl,
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
