# FLIXTV API

Vercel-native serverless API for FLIXTV. No Render service or Cloudflare Worker is required.

## Deploy

Import `leonbojni23-cloud/flixtv-api` into Vercel with the repository root as the project root and Node.js 22.x. Vercel serves each endpoint as an independent serverless function. If `ALLOWED_ORIGINS` is unset, the metadata API uses public CORS (`*`); set it to exact origins to restrict browser access.

## Endpoints

- `GET /api/health` - public health check.
- `GET /api/warmup` - public readiness check.
- `GET /api/v1/stream/movie/:tmdbId` - movie source discovery.
- `GET /api/v1/stream/tv/:tmdbId/season/:season/episode/:episode` - TV episode source discovery.

Examples:
```text
GET /api/v1/stream/movie/550
GET /api/v1/stream/tv/1399/season/1/episode/2
```

## Security

- `ALLOWED_ORIGINS` is a browser CORS allowlist, not authentication. If unset, CORS is public; setting it to exact origins restricts browser reads but does not prevent direct HTTP clients.
- `API_SHARED_SECRET` optionally requires a Bearer token for source endpoints. Do not embed this secret in browser JavaScript or a TV application; client-side secrets can be extracted.
- For a public client deployment, leave the secret unset and add platform-level rate limiting/abuse protection before enabling any provider that consumes paid or limited upstream resources.
- Never commit provider keys.

## CineSrc and HLS

The CineSrc adapter remains disabled until its documented, authorized resolver endpoint and response schema are configured. The project now includes `api/_lib/m3u8.js`, a tested HLS playlist rewriter that preserves playlist tags and metadata and converts relative segment, key, and rendition references through a server-side proxy URL builder. It requires HTTPS source URLs.

The supplied draft's HTML scraping, browser impersonation intended to defeat Cloudflare, private server-action discovery, and arbitrary-URL proxy are not deployed. Those mechanisms are not a substitute for the provider's approved integration interface. The adapter must be connected to CineSRC's approved resolver contract before it can return playable sources.

## Local checks

```bash
npm run check
npm test
```

For local Vercel function emulation, run `npm run dev` (requires Vercel CLI).
