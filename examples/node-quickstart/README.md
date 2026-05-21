# Node quickstart

Exercise the two API styles BrowseFleet exposes from Node + TypeScript: one-shot endpoints that use an ephemeral context server-side, and explicit sessions that you create, drive, and release. Uses `node:fetch` against the REST API, no SDK dependency.

## Prerequisites

- Node 20+.
- A BrowseFleet server running at `http://localhost:3000`.

## Run

```bash
npm install
npm start
```

## What it does

1. Hits `/health` to confirm the server is reachable.
2. Calls `POST /v1/scrape` against `https://example.com` and prints the first 200 chars of extracted markdown.
3. Calls `POST /v1/screenshot` for a full-page PNG, writes `example.png`.
4. Creates a session via `POST /v1/sessions`, runs a `navigate` + `screenshot` action batch via `POST /v1/sessions/<id>/actions`, then releases.

Steps 2 and 3 use ephemeral browser contexts server-side, no session id required. Step 4 demonstrates the explicit-session flow for cases where you need state to persist across calls (e.g. a logged-in profile, a multi-step flow, the CDP proxy).

## Customize

Set `BROWSEFLEET_URL` and `BROWSEFLEET_API_KEY` env vars to point at a non-local server.

```bash
BROWSEFLEET_URL=https://bf.yourdomain.com BROWSEFLEET_API_KEY=<key> npm start
```
