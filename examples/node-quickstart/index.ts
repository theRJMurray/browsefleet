import { writeFileSync } from 'node:fs';

const BASE_URL = process.env.BROWSEFLEET_URL ?? 'http://localhost:3000';
const API_KEY = process.env.BROWSEFLEET_API_KEY;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
    ...extra,
  };
}

async function main() {
  console.log('Step 1: Health check');
  const healthRes = await fetch(`${BASE_URL}/health`);
  if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
  const health = (await healthRes.json()) as {
    status: string;
    activeSessions: number;
    maxSessions: number;
  };
  console.log(`  status=${health.status} active=${health.activeSessions}/${health.maxSessions}`);

  console.log(
    '\nStep 2: Scrape https://example.com (uses an ephemeral browser context server-side)',
  );
  const scrapeRes = await fetch(`${BASE_URL}/v1/scrape`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ url: 'https://example.com' }),
  });
  if (!scrapeRes.ok)
    throw new Error(`Scrape failed: ${scrapeRes.status} ${await scrapeRes.text()}`);
  const scrape = (await scrapeRes.json()) as {
    url: string;
    statusCode: number;
    title: string;
    markdown: string;
  };
  console.log('  URL:', scrape.url);
  console.log('  Status:', scrape.statusCode);
  console.log('  Title:', scrape.title);
  console.log('  Markdown (first 200 chars):', scrape.markdown.slice(0, 200), '...');

  console.log('\nStep 3: Full-page screenshot to example.png');
  const shotRes = await fetch(`${BASE_URL}/v1/screenshot`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ url: 'https://example.com', format: 'png', fullPage: true }),
  });
  if (!shotRes.ok) throw new Error(`Screenshot failed: ${shotRes.status} ${await shotRes.text()}`);
  const buf = Buffer.from(await shotRes.arrayBuffer());
  writeFileSync('example.png', buf);
  console.log(`  Wrote example.png (${buf.length} bytes)`);

  console.log('\nStep 4: Multi-step flow on an explicit session (navigate, screenshot, release)');
  const sessionRes = await fetch(`${BASE_URL}/v1/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ stealth: 'full' }),
  });
  if (!sessionRes.ok)
    throw new Error(`Session create failed: ${sessionRes.status} ${await sessionRes.text()}`);
  const session = (await sessionRes.json()) as { id: string };
  console.log('  Session id:', session.id);

  try {
    const actionsRes = await fetch(`${BASE_URL}/v1/sessions/${session.id}/actions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        actions: [{ type: 'navigate', url: 'https://example.com' }, { type: 'screenshot' }],
      }),
    });
    if (!actionsRes.ok)
      throw new Error(`Actions failed: ${actionsRes.status} ${await actionsRes.text()}`);
    const actions = (await actionsRes.json()) as {
      results: Array<{ type: string; success: boolean }>;
    };
    console.log(
      '  Action results:',
      actions.results.map((r) => `${r.type}=${r.success}`).join(', '),
    );
  } finally {
    const releaseRes = await fetch(`${BASE_URL}/v1/sessions/${session.id}/release`, {
      method: 'POST',
      headers: headers(),
    });
    if (releaseRes.ok) console.log('  Released session.');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
