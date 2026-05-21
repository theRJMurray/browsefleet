# Configuration

All configuration is via environment variables. The full list with safe defaults lives in [`.env.example`](../.env.example); copy it to `.env` for a local dev run. The source of truth is the zod schema in [`src/config.ts`](../src/config.ts).

There is no `config.json`, no `config.yaml`, no admin UI. Twelve-factor.

## Server

| Variable    | Default   | Description                                                       |
| ----------- | --------- | ----------------------------------------------------------------- |
| `PORT`      | `3000`    | HTTP and CDP WebSocket port.                                      |
| `HOST`      | `0.0.0.0` | Bind address. Use `127.0.0.1` to restrict to localhost.           |
| `LOG_LEVEL` | `info`    | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. Uses pino. |
| `DATA_DIR`  | `./data`  | Root for the SQLite DB, profiles, and runtime data.               |

## Authentication and rate limiting

| Variable   | Default | Description                                                                                                  |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `API_KEYS` | empty   | Comma-separated list of API keys. Empty means no auth. Set this before exposing the server beyond localhost. |

Auth uses a timing-safe comparison on the `x-api-key` header. The first key in the list is treated identically to any other; there is no "admin" key.

Rate limiting is a fixed-window, in-memory counter (10 requests per second, resets every second). The bucket is keyed on `x-api-key` if present, otherwise on `x-forwarded-for`, otherwise on the literal string `"anonymous"`. There is no per-IP limit _in addition_ to the per-key limit; the key picks one bucket per request. State is process-local and does not survive restarts.

## Browser pool

| Variable                  | Default             | Description                                                       |
| ------------------------- | ------------------- | ----------------------------------------------------------------- |
| `MAX_CONCURRENT_SESSIONS` | `30`                | Cap on simultaneously live sessions. Hits 429 above this.         |
| `DEFAULT_SESSION_TIMEOUT` | `1800000` (30 min)  | Idle timeout per session in ms.                                   |
| `MAX_SESSION_TIMEOUT`     | `86400000` (24 h)   | Hard ceiling on `sessionTimeout` requested by clients.            |
| `CHROME_PATH`             | empty (auto-detect) | Absolute path to Chrome or Chromium. Set if auto-detection fails. |

Chrome with stealth wants 200 to 500 MB of RAM per active session under load. Size `MAX_CONCURRENT_SESSIONS` to your host. For a 4 GB box, 8 to 12 is realistic; for a 16 GB box, 30 to 50.

## Stealth

| Variable          | Default | Description                                                                                                 |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `STEALTH_DEFAULT` | `full`  | One of `none`, `basic`, or `full`. Controls the default for new sessions. Callers can override per session. |

`full` activates `puppeteer-extra-plugin-stealth` plus per-session randomized viewport, user agent, and platform fingerprints. `basic` keeps the plugin but skips the per-session randomization. `none` disables both. See [stealth](./stealth.md) for when each makes sense.

## Network

| Variable              | Default     | Description                                                                                                        |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `PROXY_URL`           | empty       | Global outbound proxy URL (`http://user:pass@host:port`). Per-session `proxy` field overrides this.                |
| `CDP_EXTERNAL_HOST`   | `localhost` | Host portion of the `cdpUrl` returned to clients. Set to your public hostname when running behind a reverse proxy. |
| `CDP_EXTERNAL_PORT`   | `3000`      | Port portion of the `cdpUrl`.                                                                                      |
| `CDP_EXTERNAL_SCHEME` | `ws`        | `ws` or `wss`. Set to `wss` when terminating TLS in front of the server.                                           |

The CDP URL is constructed at session-creation time and returned in the session response. If you change these vars after sessions have been created, those sessions still hold the old URL. Restart between deploys.

## CAPTCHA

| Variable           | Default    | Description                                                                                          |
| ------------------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| `CAPTCHA_API_KEY`  | empty      | API key for the CAPTCHA solving provider. Required only if you use `/v1/sessions/:id/captcha/solve`. |
| `CAPTCHA_PROVIDER` | `2captcha` | One of `2captcha` or `anticaptcha`.                                                                  |

## AI agent

| Variable            | Default | Description                                                 |
| ------------------- | ------- | ----------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | empty   | Anthropic API key for `/v1/agent` tasks that select Claude. |
| `OPENAI_API_KEY`    | empty   | OpenAI API key for `/v1/agent` tasks that select GPT.       |

At least one is required if you use the `/v1/agent` endpoint. See [agent](./agent.md).

## Production checklist

When you take a BrowseFleet host off localhost, set at minimum:

1. `API_KEYS=<long random list, comma separated>`.
2. `HOST=127.0.0.1` if you are terminating TLS and routing through a reverse proxy on the same host. Otherwise leave `0.0.0.0` and use a firewall.
3. `CDP_EXTERNAL_HOST=<your public hostname>` and `CDP_EXTERNAL_SCHEME=wss` if clients connect to CDP over TLS.
4. `LOG_LEVEL=info` (not `debug`).
5. `DATA_DIR=/var/lib/browsefleet` or another stable path; the default `./data` is fine for Docker volumes but easy to lose on bare-metal installs.

[Deployment](./deployment.md) walks through three recipe deployments that already wire these defaults correctly.

## See also

- [`.env.example`](../.env.example), the canonical template.
- [`src/config.ts`](../src/config.ts), the zod schema.
- [Deployment](./deployment.md), where these settings matter most.
