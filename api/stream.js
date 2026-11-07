// api/stream.js
import { getStreamData } from '../lib/cinesrc.js';

export default async function handler(req, res) {
  // CORS për Flixtv
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, type = 'movie', season, episode } = req.query;
  if (!id) {
    return res.status(400).json({ success: false, error: 'Mungon TMDB ID' });
  }

  // Cache i fuqishëm në Vercel Edge për 5 minuta
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const { rawM3U8, subtitles } = await getStreamData({
      tmdbId: id,
      type,
      season,
      episode
    });

    const proxyUrl = `/api/proxy?url=${encodeURIComponent(rawM3U8)}`;

    return res.status(200).json({
      success: true,
      source: 'cinesrc',
      streamUrl: proxyUrl,
      originalUrl: rawM3U8,
      subtitles: subtitles.map(sub => ({
        ...sub,
        url: `/api/proxy?url=${encodeURIComponent(sub.url)}`
      }))
    });
  } catch (error) {
    console.error('Gabim në stream.js:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: 'Dështoi marrja e stream-it.',
      details: error.message 
    });
  }
}
