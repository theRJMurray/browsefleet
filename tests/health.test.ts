import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { BrowserPool } from '../src/pool/browser-pool.js';

let app: ReturnType<typeof createApp>;
let pool: BrowserPool;

beforeAll(() => {
  pool = new BrowserPool();
  app = createApp(pool);
});

afterAll(async () => {
  await pool.shutdown();
});

describe('GET /health', () => {
  it('returns 200 with the documented JSON shape', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ok',
      version: expect.any(String),
      activeSessions: expect.any(Number),
      maxSessions: expect.any(Number),
      uptime: expect.any(Number),
    });
  });

  it('reports zero active sessions when the pool is empty', async () => {
    const res = await app.request('/health');
    const body = await res.json();
    expect(body.activeSessions).toBe(0);
  });

  it('reports a max session count greater than zero', async () => {
    const res = await app.request('/health');
    const body = await res.json();
    expect(body.maxSessions).toBeGreaterThan(0);
  });

  it('does not require an x-api-key header', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
