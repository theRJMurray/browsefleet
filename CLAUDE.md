# BrowseFleet — Cloud Browser API

Open-source headless browser API for AI agents and automation. Competing with Steel.dev.

## Quick Start

```bash
npm install
npm run dev          # Development with hot reload
# or
docker-compose up    # Production with Docker
```

## Architecture

Single Node.js process managing Chrome child processes via puppeteer-core/puppeteer-extra.

- **Hono** REST API on port 3000
- **WebSocket** CDP proxy on the same port (`/cdp/:sessionId`)
- **SQLite** (better-sqlite3) for usage tracking + API keys
- **puppeteer-extra + stealth** for anti-detection

## Key Directories

- `src/pool/` — BrowserPool + BrowserSession (Chrome lifecycle management)
- `src/proxy/` — CDP WebSocket proxy (transparent, bidirectional)
- `src/routes/` — All API endpoints
- `src/extract/` — HTML → markdown/readability content extraction
- `src/stealth/` — Anti-detection configuration
- `src/db/` — SQLite schema + usage tracking

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/v1/sessions` | Create browser session |
| GET | `/v1/sessions` | List active sessions |
| GET | `/v1/sessions/:id` | Get session details |
| POST | `/v1/sessions/:id/control` | Switch agent/human/paused control + sensitive mode |
| POST | `/v1/sessions/:id/release` | Release session |
| POST | `/v1/sessions/release` | Release all/batch |
| WS | `/cdp/:sessionId` | CDP WebSocket proxy |
| POST | `/v1/scrape` | Scrape URL → HTML/markdown/text |
| POST | `/v1/screenshot` | Screenshot URL → PNG/JPEG |
| POST | `/v1/pdf` | PDF from URL |
| POST | `/v1/sessions/:id/actions` | Computer API (click/type/scroll) |
| POST | `/v1/sessions/:id/captcha/solve` | Solve CAPTCHA via 2captcha |
| CRUD | `/v1/profiles` | Browser profile management |
| POST | `/v1/sessions/:id/files` | Upload file to session |
| GET | `/v1/sessions/:id/files/:name` | Download file from session |
| GET | `/v1/sessions/:id/live` | SSE live session viewer |
| GET | `/v1/sessions/:id/events` | SSE operator stream with URL/title/control/screenshot |
| GET | `/v1/usage` | Usage statistics |

## Operator Mode

Browser Relay uses BrowseFleet sessions as human-authenticated provider-console workspaces.

Create a persistent provider profile:

```bash
curl -X POST localhost:3000/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"name":"RJ Vercel","provider":"vercel"}'
```

Start an operator session from that profile:

```bash
curl -X POST localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"profileId":"<profile-id>","operatorMode":true,"headless":true}'
```

New session fields:

- `profileId` attaches the browser to a persistent Chrome user-data directory.
- `operatorMode:true` starts in `human` control so an agent cannot type until RJ resumes.
- `headless:false` is available for local headed Chrome; the default remains headless for cloud/runtime use.
- `sensitiveMode:true` suppresses screenshots in `/actions`, `/live`, and `/events`.
- `eventsUrl` streams snapshots with `url`, `title`, `controlMode`, `sensitiveMode`, and a screenshot when allowed.

Switch control:

```bash
curl -X POST localhost:3000/v1/sessions/<session-id>/control \
  -H 'Content-Type: application/json' \
  -d '{"controlMode":"agent","sensitiveMode":false,"reason":"RJ completed login"}'
```

`controlMode` values:

- `agent` — automation input is allowed.
- `human` — click/type/navigate actions return `423` until resumed.
- `paused` — same input lock as `human`, used for approvals or investigation.

Screenshot actions and event streams stay available unless `sensitiveMode` is enabled. This lets Overlord show the live browser while preventing accidental credential capture during secret entry.

## Environment Variables

See `.env.example` for all options. Key ones:
- `API_KEYS` — comma-separated API keys (empty = no auth)
- `MAX_CONCURRENT_SESSIONS` — default 30
- `STEALTH_DEFAULT` — none/basic/full (default: full)
- `CHROME_PATH` — path to Chrome/Chromium binary
- `CAPTCHA_API_KEY` — 2captcha API key for CAPTCHA solving
- `PROXY_URL` — global proxy URL

## Testing

```bash
# Health check
curl localhost:3000/health

# Create session
curl -X POST localhost:3000/v1/sessions -H 'Content-Type: application/json'

# Scrape
curl -X POST localhost:3000/v1/scrape -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'

# Screenshot
curl -X POST localhost:3000/v1/screenshot -H 'Content-Type: application/json' -d '{"url":"https://example.com"}' --output screenshot.png
```

## Domain

browsefleet.com
