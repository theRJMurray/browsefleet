# Python quickstart

Exercise the two API styles BrowseFleet exposes from Python 3.10+: one-shot endpoints that use an ephemeral context server-side, and explicit sessions that you create, drive, and release. Uses `httpx` against the REST API, no SDK dependency.

## Prerequisites

- Python 3.10+.
- A BrowseFleet server running at `http://localhost:3000`.

## Run

```bash
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
python main.py
```

## What it does

1. Hits `/health` to confirm the server is reachable.
2. Calls `POST /v1/scrape` against `https://example.com` and prints the first 200 chars of extracted markdown.
3. Calls `POST /v1/screenshot` for a full-page PNG, writes `example.png`.
4. Creates a session via `POST /v1/sessions`, runs a `navigate` + `screenshot` action batch, then releases.

Steps 2 and 3 use ephemeral browser contexts server-side. Step 4 demonstrates the explicit-session flow for multi-step state-sharing.

## Customize

```bash
BROWSEFLEET_URL=https://bf.yourdomain.com BROWSEFLEET_API_KEY=<key> python main.py
```
