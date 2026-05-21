import puppeteer from 'puppeteer-core';

const BASE_URL = process.env.BROWSEFLEET_URL ?? 'http://localhost:3000';
const API_KEY = process.env.BROWSEFLEET_API_KEY;

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
  };
}

async function main() {
  console.log('Step 1: Create a BrowseFleet session via REST');
  const sessionRes = await fetch(`${BASE_URL}/v1/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ stealth: 'full' }),
  });
  if (!sessionRes.ok) throw new Error(`Session create failed: ${sessionRes.status}`);
  const session = (await sessionRes.json()) as { id: string; websocketUrl: string };
  console.log('  Session id:', session.id);
  console.log('  CDP URL:', session.websocketUrl);

  // If your BrowseFleet host requires an API key, append it to the WS URL.
  const wsEndpoint = API_KEY
    ? `${session.websocketUrl}?apiKey=${encodeURIComponent(API_KEY)}`
    : session.websocketUrl;

  console.log('\nStep 2: Connect puppeteer-core to the CDP proxy');
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  try {
    const page = await browser.newPage();

    console.log('\nStep 3: Drive the browser via raw Puppeteer API');
    await page.goto('https://example.com', { waitUntil: 'networkidle2' });
    const title = await page.title();
    const h1 = await page.$eval('h1', (el) => el.textContent ?? '');
    console.log('  Title:', title);
    console.log('  H1:', h1);

    await page.close();
  } finally {
    console.log('\nStep 4: Disconnect (BrowseFleet still owns the underlying browser)');
    await browser.disconnect();
  }

  console.log('\nStep 5: Release the BrowseFleet session');
  await fetch(`${BASE_URL}/v1/sessions/${session.id}/release`, {
    method: 'POST',
    headers: headers(),
  });
  console.log('  Released.');
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
