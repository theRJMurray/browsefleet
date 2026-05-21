# API Reference

The BrowseFleet HTTP API. All endpoints return JSON unless otherwise noted. Authentication is the `x-api-key` header when `API_KEYS` is configured; omit it when running unauthenticated (default for local dev).

The source of truth is the TypeScript types in [`src/types.ts`](../src/types.ts) and the route handlers in [`src/routes/`](../src/routes/). If this doc and the code disagree, the code is right; file an issue.

## Conventions

- Base URL: `http://localhost:3000` for local dev. Wherever you host it in production.
- Auth header: `x-api-key: <key>`. Required when `API_KEYS` is non-empty.
- Content type: `application/json` for request bodies. Responses are JSON unless the endpoint returns a binary (screenshot PNG, PDF).
- Error shape: `{ "error": "<message>" }` with a 4xx or 5xx status.
- All timestamps are ISO 8601 UTC.

## Health

### `GET /health`

No auth. Returns server status.

```bash
curl localhost:3000/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "activeSessions": 0,
  "maxSessions": 30,
  "uptime": 42.3
}
```

## Sessions

### `POST /v1/sessions`

Create a new browser session. All fields are optional; the empty body `{}` works.

```bash
curl -X POST localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "stealth": "full",
    "viewport": { "width": 1920, "height": 1080 },
    "operatorMode": false,
    "profileId": null
  }'
```

Notable fields:

| Field           | Type                             | Description                                                                 |
| --------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `stealth`       | `'none' \| 'basic' \| 'full'`    | Per-session override of `STEALTH_DEFAULT`.                                  |
| `headless`      | `boolean`                        | Default `true`. `false` for local headed Chrome.                            |
| `viewport`      | `{ width, height }`              | Default random within sane bounds.                                          |
| `userAgent`     | `string`                         | Override the stealth-generated UA.                                          |
| `profileId`     | `string`                         | Attach to a persistent profile (see [profiles](./profiles.md)).             |
| `operatorMode`  | `boolean`                        | Start session in `human` control (see [operator mode](./operator-mode.md)). |
| `sensitiveMode` | `boolean`                        | Suppress screenshots until cleared.                                         |
| `proxyUrl`      | `string`                         | Per-session outbound proxy.                                                 |
| `timezone`      | `string`                         | IANA timezone, e.g. `America/Toronto`.                                      |
| `locale`        | `string`                         | BCP 47 locale, e.g. `en-US`.                                                |
| `timeout`       | `number`                         | Idle timeout in ms. Capped at `MAX_SESSION_TIMEOUT`.                        |
| `cookies`       | `Array<{ name, value, domain }>` | Pre-set cookies.                                                            |
| `headers`       | `Record<string, string>`         | Extra HTTP headers on every navigation.                                     |
| `blockAds`      | `boolean`                        | Filter common ad/tracker hosts.                                             |

Response: `201 Created` with the `Session` object.

```json
{
  "id": "76affe61-...",
  "status": "active",
  "websocketUrl": "ws://localhost:3000/cdp/76affe61-...",
  "viewerUrl": "http://localhost:3000/v1/sessions/76affe61-.../live",
  "eventsUrl": "http://localhost:3000/v1/sessions/76affe61-.../events",
  "createdAt": "2026-05-21T20:30:00.000Z",
  "expiresAt": "2026-05-21T21:00:00.000Z",
  "timeout": 1800000,
  "stealth": "full",
  "viewport": { "width": 1920, "height": 1080 },
  "operatorMode": false,
  "controlMode": "agent",
  "sensitiveMode": false
}
```

Errors: `429 Too Many Requests` if `MAX_CONCURRENT_SESSIONS` is exceeded.

### `GET /v1/sessions`

List active sessions owned by the calling API key. Returns `{ sessions: Session[], count: number }`.

### `GET /v1/sessions/:id`

Fetch one session. Returns the `Session` object or `404`.

### `POST /v1/sessions/:id/release`

Release one session. Returns `{ released: true }` or `404`.

### `POST /v1/sessions/release`

Release multiple sessions. Body: `{ ids: string[] }`. Returns `{ released: number }`.

### `POST /v1/sessions/:id/control`

Switch the session's control mode. See [operator mode](./operator-mode.md).

```bash
curl -X POST localhost:3000/v1/sessions/<id>/control \
  -H 'Content-Type: application/json' \
  -d '{"controlMode":"agent","sensitiveMode":false,"reason":"operator completed login"}'
```

`controlMode` is one of `agent`, `human`, `paused`. Returns the updated `Session`.

## CDP proxy

### `WS /cdp/:sessionId`

Direct Chrome DevTools Protocol WebSocket. Use with `puppeteer.connect()` or `chromium.connect()`. See the [`cdp-direct` example](../examples/cdp-direct/).

```ts
import { connect } from 'puppeteer-core';
const browser = await connect({ browserWSEndpoint: session.websocketUrl });
const page = await browser.newPage();
```

Auth: pass `x-api-key` as a WebSocket protocol header, or include in the URL as `?apiKey=<key>` (timing-safe match server-side).

## One-shot actions (no session needed)

These endpoints lease an ephemeral browser context, do the work, release the context. No session bookkeeping required.

### `POST /v1/scrape`

```bash
curl -X POST localhost:3000/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
```

Body: `{ url, waitFor?, headers?, cookies?, proxyUrl?, stealth?, timeout? }`. `waitFor` is either a CSS selector or a ms duration.

Response: `{ url, statusCode, title, html, cleanedHtml, markdown, readability, links, metadata }`.

### `POST /v1/screenshot`

Returns a binary image. Set `Accept: image/png` or omit; the server uses `format` from the body.

```bash
curl -X POST localhost:3000/v1/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","fullPage":true,"format":"png"}' \
  --output example.png
```

Body: `{ url, fullPage?, viewport?, quality?, format?, waitFor?, proxyUrl?, stealth?, timeout? }`.

### `POST /v1/pdf`

Returns a binary PDF.

```bash
curl -X POST localhost:3000/v1/pdf \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","format":"A4","landscape":false,"printBackground":true}' \
  --output example.pdf
```

## Computer API (per-session actions)

### `POST /v1/sessions/:id/actions`

Execute a sequence of low-level browser actions against a live session.

```bash
curl -X POST localhost:3000/v1/sessions/<id>/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "actions": [
      { "type": "navigate", "url": "https://example.com" },
      { "type": "screenshot" },
      { "type": "click", "x": 100, "y": 200 },
      { "type": "type", "text": "hello" },
      { "type": "press_key", "key": "Enter" }
    ]
  }'
```

Action types: `screenshot`, `click`, `type`, `press_key`, `scroll`, `move_mouse`, `wait`, `navigate`. Returns `{ results: Array<{ type, success, screenshot?, error? }> }`.

Control gating: if the session is in `human` or `paused` control mode and any action in the batch is something other than `screenshot` or `wait`, the entire request is rejected with `423 Locked`. The `screenshot` action additionally returns `success: false` per-result when `sensitiveMode` is on. Other actions that emit screenshots (`click`, `type`, `scroll`, `navigate`) simply omit the screenshot field under `sensitiveMode`.

## CAPTCHA

### `POST /v1/sessions/:id/captcha/solve`

Solve a CAPTCHA on the session's current page. Requires `CAPTCHA_API_KEY` in env.

```bash
curl -X POST localhost:3000/v1/sessions/<id>/captcha/solve \
  -H 'Content-Type: application/json' \
  -d '{"type":"auto"}'
```

`type` is one of `auto`, `recaptcha`, `hcaptcha`, `turnstile`. Returns `{ success, type, duration, error? }`.

## Profiles

Persistent Chrome user-data directories. See [profiles](./profiles.md).

### `POST /v1/profiles`

```bash
curl -X POST localhost:3000/v1/profiles \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-vendor-profile"}'
```

Returns the created `Profile`.

### `GET /v1/profiles`

List profiles.

### `GET /v1/profiles/:id`

Fetch one profile.

### `DELETE /v1/profiles/:id`

Delete a profile and its user-data directory. Returns `{ deleted: true }` on success. The server does not currently check whether a live session has the profile attached; deleting an in-use profile is a foot-gun. Release sessions first.

## Files (per-session)

### `POST /v1/sessions/:id/files`

Upload a file to the session's `/tmp/bf-uploads-<id>/` directory. `multipart/form-data` with field `file`. Returns `{ uploaded: <safe-filename>, size: <bytes> }`.

### `GET /v1/sessions/:id/files`

List uploaded and downloaded files for the session. Returns `{ files: string[] }` where each entry is prefixed `uploads/` or `downloads/`.

### `GET /v1/sessions/:id/files/:name`

Download a file by basename. Checks `uploads/` then `downloads/`. Returns the binary as `application/octet-stream` with a `Content-Disposition: attachment` header, or `404` if not found.

## Live viewer and event stream

### `GET /v1/sessions/:id/live`

Server-sent events. Every 500 ms (roughly 2 fps), one event is emitted with a JSON body: `{ sessionId, status, controlMode, sensitiveMode, controlReason?, url, title, screenshot?, screenshotSuppressed? }`. `screenshot` is a base64 JPEG of the viewport at quality 50. When `sensitiveMode` is on the field is replaced by `screenshotSuppressed: true`.

To render in a browser, subscribe with `EventSource` and update an `<img>` element per event:

```js
const es = new EventSource('/v1/sessions/' + id + '/live');
es.onmessage = (e) => {
  const snap = JSON.parse(e.data);
  if (snap.screenshot) img.src = 'data:image/jpeg;base64,' + snap.screenshot;
};
```

The stream auto-closes after 5 minutes; reconnect to continue.

### `GET /v1/sessions/:id/events`

Server-sent events. Same payload shape as `/live` but emitted as a named `snapshot` event once per second. Lower frame rate, intended for operator-mode UIs that drive state from page changes rather than rendering a live video. `screenshot` is base64 JPEG at quality 45 and is replaced by `screenshotSuppressed: true` when `sensitiveMode` is on.

## AI agent

### `POST /v1/agent` or `POST /v1/sessions/:id/agent`

Vision-based browser automation. See [agent](./agent.md).

```bash
curl -X POST localhost:3000/v1/agent \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Find the cheapest flight from YYZ to JFK on June 15",
    "url": "https://google.com/flights",
    "provider": "anthropic",
    "maxIterations": 15
  }'
```

Requires `ANTHROPIC_API_KEY` (for `provider:"anthropic"`) or `OPENAI_API_KEY` (for `provider:"openai"`).

`maxIterations` defaults to 15 and is clamped to a hard ceiling of 30. Returns an `AgentResult` with the final answer plus a step-by-step trace including screenshots (intermediate screenshots are stripped from the response; only the final iteration keeps one to reduce payload size).

### `POST /v1/agent/stream`

Streaming variant that creates an ephemeral session and emits server-sent events as the agent runs. Each event is a JSON object with a `type` field of one of `screenshot`, `step`, `done`, `fail`, or `error`. The session is released automatically when the stream ends.

## Usage

### `GET /v1/usage`

Aggregate stats for the calling API key.

```json
{
  "totalSessions": 142,
  "activeSessions": 3,
  "totalBrowserHours": 27.4,
  "todayBrowserHours": 1.2,
  "todayApiCalls": 89,
  "daily": [{ "date": "2026-05-21", "sessions": 12, "browserHours": 1.2, "apiCalls": 89 }]
}
```

## Error codes

| Status | Meaning                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------- |
| 400    | Malformed request body or invalid field.                                                                 |
| 401    | Missing or invalid `x-api-key`.                                                                          |
| 403    | Session belongs to a different API key.                                                                  |
| 404    | Session, profile, or file not found.                                                                     |
| 423    | Session is in `human` or `paused` control; the requested action batch is locked.                         |
| 429    | Rate limit hit, or `MAX_CONCURRENT_SESSIONS` reached.                                                    |
| 500    | Unhandled server error. Check logs.                                                                      |
| 501    | Feature requires server configuration that is not set (e.g. `/captcha/solve` without `CAPTCHA_API_KEY`). |

## See also

- [`src/types.ts`](../src/types.ts), the canonical type definitions.
- [Configuration](./configuration.md), env vars that affect behavior.
- [Operator mode](./operator-mode.md), the human-in-the-loop control state machine.
- [Agent](./agent.md), the AI agent layer.
