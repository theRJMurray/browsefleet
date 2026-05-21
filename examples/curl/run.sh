#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BROWSEFLEET_URL:-http://localhost:3000}"
API_KEY_HEADER=""
if [ -n "${BROWSEFLEET_API_KEY:-}" ]; then
  API_KEY_HEADER="-H x-api-key:${BROWSEFLEET_API_KEY}"
fi

echo "Step 1: Health check"
curl -fsS $API_KEY_HEADER "${BASE_URL}/health" | jq .
echo ""

echo "Step 2: Create session"
SESSION_ID=$(curl -fsS -X POST $API_KEY_HEADER \
  -H 'Content-Type: application/json' \
  -d '{"stealth":"full"}' \
  "${BASE_URL}/v1/sessions" | jq -r .id)
echo "Created session: ${SESSION_ID}"
echo ""

echo "Step 3: Scrape https://example.com"
curl -fsS -X POST $API_KEY_HEADER \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' \
  "${BASE_URL}/v1/scrape" | jq '{ url, statusCode, title, markdown: (.markdown | .[0:200] + "...") }'
echo ""

echo "Step 4: Screenshot to example.png"
curl -fsS -X POST $API_KEY_HEADER \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","format":"png"}' \
  --output example.png \
  "${BASE_URL}/v1/screenshot"
ls -la example.png
echo ""

echo "Step 5: PDF to example.pdf"
curl -fsS -X POST $API_KEY_HEADER \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","format":"A4"}' \
  --output example.pdf \
  "${BASE_URL}/v1/pdf"
ls -la example.pdf
echo ""

echo "Step 6: Release session"
curl -fsS -X POST $API_KEY_HEADER "${BASE_URL}/v1/sessions/${SESSION_ID}/release" | jq .
echo ""

echo "Done."
