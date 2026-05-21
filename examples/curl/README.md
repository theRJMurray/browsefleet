# curl quickstart

Every common BrowseFleet endpoint, via curl. Zero dependencies beyond `curl` and `jq`.

## Prerequisites

- A BrowseFleet server running at `http://localhost:3000` (see the top-level [`examples/README.md`](../README.md)).
- `curl` and `jq` on PATH.

## Run

```bash
./run.sh
```

Or step through the script by hand.

## What it does

1. Health check.
2. Create a session (kept for the final release; the one-shot endpoints below do not use it).
3. Scrape `https://example.com` via the one-shot `/v1/scrape` endpoint.
4. Take a screenshot of the same URL via `/v1/screenshot` to `example.png`.
5. Generate a PDF of the same URL via `/v1/pdf` to `example.pdf`.
6. Release the session.

Steps 3 to 5 use ephemeral browser contexts server-side; you would pass a session id to action endpoints (`/v1/sessions/<id>/actions`) when you need state to persist across calls.

## Cleanup

```bash
rm -f example.png example.pdf
```
