import { createInterface } from 'node:readline/promises';

const BASE_URL = process.env.BROWSEFLEET_URL ?? 'http://localhost:3000';
const API_KEY = process.env.BROWSEFLEET_API_KEY;

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
  };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  console.log('Step 1: Create a persistent profile');
  const profile = await call<{ id: string }>('POST', '/v1/profiles', {
    name: 'operator-mode-example',
  });
  console.log('  Profile id:', profile.id);

  console.log('\nStep 2: Start an operator-mode session attached to the profile');
  const session = await call<{ id: string; viewerUrl: string; eventsUrl: string; controlMode: string }>(
    'POST',
    '/v1/sessions',
    { profileId: profile.id, operatorMode: true, stealth: 'full' },
  );
  console.log('  Session id:', session.id);
  console.log('  Control mode:', session.controlMode);
  // viewerUrl / eventsUrl are absolute URLs computed by the server from CDP_EXTERNAL_*.
  console.log(`  Live viewer: ${session.viewerUrl}`);
  console.log(`  Event stream: ${session.eventsUrl}`);

  console.log('\nStep 3: Drive the browser as a human via the live viewer.');
  console.log('       Open the live viewer URL above in a browser and interact through your own UI');
  console.log('       (or post actions directly to /v1/sessions/<id>/actions from another tool).');
  console.log('       When done, type "done" here and press Enter to hand off to the agent.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const input = (await rl.question('> ')).trim().toLowerCase();
    if (input === 'done') break;
    console.log('  (type "done" to continue)');
  }
  rl.close();

  console.log('\nStep 4: Hand off to agent (controlMode: agent)');
  await call('POST', `/v1/sessions/${session.id}/control`, {
    controlMode: 'agent',
    reason: 'operator finished',
  });
  console.log('  Switched to agent control.');

  console.log('\nStep 5: Run a navigate + screenshot batch (proves agent input is unlocked)');
  // `navigate` is gated by control mode; under `human` or `paused` this whole
  // batch would have returned 423 Locked. Under `agent` it executes.
  const actions = await call<{ results: Array<{ type: string; success: boolean; screenshot?: string }> }>(
    'POST',
    `/v1/sessions/${session.id}/actions`,
    {
      actions: [
        { type: 'navigate', url: 'https://example.com' },
        { type: 'screenshot' },
      ],
    },
  );
  console.log('  Results:', actions.results.map(r => `${r.type}=${r.success}`).join(', '));

  console.log('\nStep 6: Release the session (profile persists)');
  await call('POST', `/v1/sessions/${session.id}/release`);
  console.log('  Released.');
  console.log('\nNext time, create a session with profileId:', profile.id, 'and skip the human step.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
