// lib/cinesrc.js
import * as cheerio from 'cheerio';

const DOMAINS = [
  'https://cinesrc.st',
  'https://cinesrc.com',
  'https://cinesrc.to',
  'https://cinesrc.net'
];

// Headers që imitojnë plotësisht Chrome-in e vërtetë
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,sq;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  'Connection': 'keep-alive'
};

/**
 * Merr HTML-në nga një domain specifik me headers të plota.
 */
async function fetchFromDomain(domain, path) {
  const url = `${domain}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // Timeout 5 sekonda

  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Statusi ${res.status} nga ${domain}`);
    const html = await res.text();
    
    // Nëse HTML-ja është shumë e vogël, ndoshta është faqe bllokimi
    if (html.length < 500) throw new Error(`Përgjigje e dyshimtë nga ${domain}`);
    
    return { html, baseUrl: domain, url };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Metoda 1: Regex i thjeshtë (më i shpejti)
 */
function extractM3U8_Regex(html) {
  const patterns = [
    /["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i,
    /file\s*:\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i,
    /src\s*:\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i,
    /["'](\/[^"']+?\.m3u8[^"']*)["']/i // Relative URL
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const url = match[1].replace(/\\/g, '');
      // Nëse është relative, kthejeni absolute
      return url.startsWith('http') ? url : null;
    }
  }
  return null;
}

/**
 * Metoda 2: Kërkim në JSON-in e script-eve
 */
function extractM3U8_JSON(html) {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    try {
      // Provo të gjesh objekte JSON që përmbajnë "file" ose "src"
      const jsonRegex = /({[^{}]*?"(?:file|src|url)"\s*:\s*"[^"]+?\.m3u8[^"]*"[^{}]*?})/gi;
      const jsonMatch = scriptContent.match(jsonRegex);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const url = parsed.file || parsed.src || parsed.url;
        if (url) return url;
      }
    } catch (e) { /* injoro */ }
  }
  return null;
}

/**
 * Metoda 3: Cheerio për të gjetur në DOM
 */
function extractM3U8_Cheerio(html) {
  const $ = cheerio.load(html);
  let found = null;
  $('video, source, iframe').each((i, el) => {
    const src = $(el).attr('src');
    if (src && src.includes('.m3u8')) found = src;
  });
  return found;
}

/**
 * Metoda 4: Kërkim i verbër në të gjithë HTML-në
 */
function extractM3U8_Brute(html) {
  const match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
  return match ? match[0] : null;
}

/**
 * Provo të gjitha metodat e ekstraktimit.
 */
function extractM3U8(html, baseUrl) {
  let url = extractM3U8_Regex(html);
  if (!url) url = extractM3U8_JSON(html);
  if (!url) url = extractM3U8_Cheerio(html);
  if (!url) url = extractM3U8_Brute(html);

  if (url && !url.startsWith('http')) {
    url = new URL(url, baseUrl).href;
  }
  return url;
}

/**
 * Nxjerr titrat nga HTML-ja.
 */
function extractSubtitles(html, baseUrl) {
  const subtitles = [];
  
  // 1. Nga <track> tags
  const $ = cheerio.load(html);
  $('track').each((i, el) => {
    const src = $(el).attr('src');
    const lang = $(el).attr('srclang') || $(el).attr('label') || 'unknown';
    if (src) subtitles.push({ lang: lang.toLowerCase(), url: new URL(src, baseUrl).href });
  });

  // 2. Nga JSON në script
  const subtitleRegex = /"subtitles"\s*:\s*(\[[^\]]*\])/;
  const match = html.match(subtitleRegex);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      parsed.forEach(sub => {
        if (sub.file || sub.url) {
          subtitles.push({
            lang: (sub.label || sub.language || 'unknown').toLowerCase(),
            url: new URL(sub.file || sub.url, baseUrl).href
          });
        }
      });
    } catch (e) { /* injoro */ }
  }

  return subtitles;
}

/**
 * Funksioni kryesor: Provon të gjitha domain-et PARALELISHT.
 */
export async function getStreamData({ tmdbId, type = 'movie', season, episode }) {
  let path = `/embed/${type}/${tmdbId}`;
  if (type === 'tv' && season && episode) {
    path += `?s=${season}&e=${episode}`;
  }

  // Hedhim të gjitha domain-et njëkohësisht
  const fetchPromises = DOMAINS.map(domain => 
    fetchFromDomain(domain, path).catch(err => ({ error: err.message, domain }))
  );

  // Promise.any pret rezultatin e parë të suksesshëm (që ka m3u8)
  let successResult = null;
  try {
    const results = await Promise.any(
      fetchPromises.map(async (promise) => {
        const result = await promise;
        if (result.error) throw new Error(result.error);
        
        const m3u8 = extractM3U8(result.html, result.baseUrl);
        if (!m3u8) throw new Error(`Asnjë m3u8 në ${result.baseUrl}`);
        
        return { ...result, m3u8 };
      })
    );
    successResult = results;
  } catch (aggregateError) {
    // Nëse të gjitha dështojnë, provo të paktën një herë më shumë me domain-in e parë
    const fallback = await fetchFromDomain(DOMAINS[0], path).catch(() => null);
    if (!fallback) throw new Error('Të gjitha domain-et e CineSrc dështuan');
    const m3u8 = extractM3U8(fallback.html, fallback.baseUrl);
    if (!m3u8) throw new Error('Asnjë m3u8 në fallback');
    successResult = { ...fallback, m3u8 };
  }

  const subtitles = extractSubtitles(successResult.html, successResult.baseUrl);

  return {
    rawM3U8: successResult.m3u8,
    subtitles,
    baseUrl: successResult.baseUrl
  };
}
