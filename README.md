# FLIXTV API

Backend and Cloudflare gateway for FLIXTV. Includes health checks, warm-up,
media validation, authentication, rate limiting, and a safe provider-adapter
boundary.

## Architecture

- FLIXTV calls the Cloudflare Worker.
- Worker forwards API metadata requests to Render.
- Render handles backend logic and authorized source discovery.
- Playback is handed to FLIXTV from a provider URL authorized for playback.
- Render is not in the media-segment delivery path.

This repository does not scrape CineSrc embed pages, reverse engineer private
endpoints, bypass anti-bot controls, or proxy protected streams. Configure
providers only through an authorized, documented integration.

## Local setup

Requires Node.js 20+.

```powershell
Copy-Item .env.example .env
npm install
npm run check
npm run dev
```

Set `API_SHARED_SECRET` before calling protected `/api/v1/*` endpoints.
Test health with `http://localhost:3000/health`.

## Render

Deploy as a Blueprint from `render.yaml`, or use build command `npm ci` and
start command `npm start`. Set `API_SHARED_SECRET` to a long random value.
Set `ALLOWED_ORIGINS` to exact FLIXTV origins. Keep CineSrc disabled unless an
authorized documented API integration is available.

Free Render services can spin down. `/warmup` can trigger startup, but browser
heartbeats are best-effort; background execution is throttled and uptime is not
guaranteed. Do not use synthetic traffic to evade plan limits.

## Cloudflare Worker

From `cloudflare-worker`, configure the secrets/variables
`BACKEND_URL`, `BACKEND_SECRET`, and `ALLOWED_ORIGINS`, then deploy with
Wrangler. Do not commit secrets.

## API

- `GET /health` (public)
- `GET /warmup` (public)
- `GET /api/v1/stream/movie/:id` (Bearer secret required)
- `GET /api/v1/stream/tv/:id/season/:season/episode/:episode` (Bearer secret required)

## CineSrc adapter

No authorized CineSrc API contract or permission was provided. Before
implementing it, obtain its documented endpoint, authentication, schemas, and
authorization for use. Do not assume an embed page contains an HLS URL or that
a regex over HTML is reliable.

## Verification

Run `npm run check`.
