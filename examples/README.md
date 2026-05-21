# Examples

Runnable examples for the most common BrowseFleet flows. Each subdirectory is a standalone project with its own README.

| Example                                      | Language   | Demonstrates                                                                                             |
| -------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| [`curl/`](./curl/)                           | shell      | Health, scrape, screenshot, PDF, session lifecycle. Fastest way to get a feel for the API.               |
| [`node-quickstart/`](./node-quickstart/)     | TypeScript | One-shot endpoints (`/scrape`, `/screenshot`) plus an explicit session with the `/actions` Computer API. |
| [`python-quickstart/`](./python-quickstart/) | Python     | Same flows from Python, via httpx.                                                                       |
| [`operator-mode/`](./operator-mode/)         | TypeScript | Human-to-agent handoff using profile persistence + the control state machine.                            |
| [`cdp-direct/`](./cdp-direct/)               | TypeScript | Bypass the high-level endpoints and drive Chrome over CDP via the WebSocket proxy.                       |

## Running the examples

Every example assumes a BrowseFleet server is reachable at `http://localhost:3000`. Start one from the repo root:

```bash
npm install
npm run dev
```

Or via Docker (once the image is published in Phase 3 of the OSS arc):

```bash
docker run -p 3000:3000 --shm-size=2g ghcr.io/therjmurray/browsefleet:latest
```

Then `cd` into an example directory and follow its README.

## A note on the SDKs

The Node and Python examples use raw `fetch` / `httpx` against the REST API. Once the official SDKs land on npm and PyPI (Phase 7 of the OSS transformation arc), these examples will get an SDK-flavored variant alongside the raw-HTTP variant. Until then, raw HTTP is the only stable path.
