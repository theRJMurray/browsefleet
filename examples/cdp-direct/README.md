# CDP direct example

Bypass the high-level endpoints and drive Chrome directly via the BrowseFleet CDP WebSocket proxy. Demonstrates `puppeteer-core`'s `connect()` against the URL BrowseFleet returns.

Use this pattern when:

- You need a Chrome DevTools feature BrowseFleet does not expose as a high-level endpoint.
- You are migrating from a self-hosted Puppeteer setup and want to keep the same code surface.
- You need to attach Playwright or Puppeteer dev tools (Recorder, Inspector) to a remote session.

## Prerequisites

- Node 20+.
- A BrowseFleet server running at `http://localhost:3000`.

## Run

```bash
npm install
npm start
```

## What it does

1. Creates a BrowseFleet session via the REST API.
2. Reads the `websocketUrl` from the response.
3. `puppeteer.connect({ browserWSEndpoint })` to that URL.
4. Opens a new page, navigates to `https://example.com`, evaluates `document.title`.
5. Disconnects (does not close the browser, BrowseFleet owns its lifecycle).
6. Releases the BrowseFleet session.

## Why use BrowseFleet at all if you are going to drive CDP directly?

Two reasons stick:

1. **Pool management.** You do not write the BrowserPool, the session expiration timer, the graceful shutdown path. BrowseFleet does.
2. **Stealth defaults.** The session is already wrapped in `puppeteer-extra-plugin-stealth` with per-session randomization. Connecting via CDP keeps the stealth properties without you re-implementing them.

If neither of those matters to you, use raw Puppeteer or Playwright instead.

## See also

- [`docs/api.md#cdp-proxy`](../../docs/api.md#cdp-proxy)
