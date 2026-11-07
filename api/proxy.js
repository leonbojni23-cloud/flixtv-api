// api/proxy.js
import { rewritePlaylist } from '../lib/m3u8.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return new Response('Mungon parametri url', { status: 400 });
  }

  try {
    // Kërkesa për të marrë burimin
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://cinesrc.st/',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://cinesrc.st'
      }
    });

    if (!response.ok) {
      throw new Error(`Statusi i burimit: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const isM3U8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl');

    if (isM3U8) {
      let playlist = await response.text();
      const proxyBase = new URL(req.url).origin + '/api/proxy?url=';
      const rewritten = rewritePlaylist(playlist, targetUrl, proxyBase);

      return new Response(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=10, s-maxage=10'
        }
      });
    }

    // Për segmente video (.ts) ose titra – STREAMING direkt pa e ngarkuar në memorie
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600' // Cache 1 orë për segmentet
      }
    });
  } catch (error) {
    return new Response(`Gabim në Proxy: ${error.message}`, { status: 500 });
  }
}
