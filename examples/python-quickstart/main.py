"""BrowseFleet Python quickstart.

Exercises both styles of API call against a local BrowseFleet server:

1. One-shot endpoints (`/scrape`, `/screenshot`) which use ephemeral browser
   contexts server-side, no session bookkeeping required.
2. An explicit session via `/v1/sessions` + `/v1/sessions/<id>/actions` for
   multi-step flows that need to share state across calls.

No SDK dependency; raw HTTP via httpx.
"""

from __future__ import annotations

import os
import sys

import httpx

BASE_URL = os.environ.get("BROWSEFLEET_URL", "http://localhost:3000")
API_KEY = os.environ.get("BROWSEFLEET_API_KEY")


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["x-api-key"] = API_KEY
    return headers


def main() -> int:
    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=60.0) as client:
        print("Step 1: Health check")
        resp = client.get("/health")
        resp.raise_for_status()
        health = resp.json()
        print(f"  status={health['status']} active={health['activeSessions']}/{health['maxSessions']}")

        print("\nStep 2: Scrape https://example.com (ephemeral context)")
        resp = client.post("/v1/scrape", json={"url": "https://example.com"})
        resp.raise_for_status()
        scrape = resp.json()
        print(f"  URL: {scrape['url']}")
        print(f"  Status: {scrape['statusCode']}")
        print(f"  Title: {scrape['title']}")
        print(f"  Markdown (first 200 chars): {scrape['markdown'][:200]}...")

        print("\nStep 3: Full-page screenshot to example.png")
        resp = client.post(
            "/v1/screenshot",
            json={"url": "https://example.com", "format": "png", "fullPage": True},
        )
        resp.raise_for_status()
        with open("example.png", "wb") as fh:
            fh.write(resp.content)
        print(f"  Wrote example.png ({len(resp.content)} bytes)")

        print("\nStep 4: Multi-step flow on an explicit session")
        resp = client.post("/v1/sessions", json={"stealth": "full"})
        resp.raise_for_status()
        session_id = resp.json()["id"]
        print(f"  Session id: {session_id}")

        try:
            resp = client.post(
                f"/v1/sessions/{session_id}/actions",
                json={
                    "actions": [
                        {"type": "navigate", "url": "https://example.com"},
                        {"type": "screenshot"},
                    ],
                },
            )
            resp.raise_for_status()
            results = resp.json()["results"]
            summary = ", ".join(f"{r['type']}={r['success']}" for r in results)
            print(f"  Action results: {summary}")
        finally:
            release = client.post(f"/v1/sessions/{session_id}/release")
            if release.status_code == 200:
                print("  Released session.")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
