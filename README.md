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

## CineSrc

The adapter is intentionally disabled until an authorized, documented CineSrc API contract is available. It does not scrape embed HTML, reverse engineer private endpoints, bypass anti-bot protections, or proxy protected streams. A generic HLS player or proxy cannot make unauthorized content distribution permissible.

To complete the adapter, supply the provider's official API documentation, permitted use, authentication method, and response schema. Then the server-side adapter can be implemented against that contract without exposing provider credentials to FLIXTV.

## Local checks

```bash
npm run check
npm test
```

For local Vercel function emulation, run `npm run dev` (requires Vercel CLI).
