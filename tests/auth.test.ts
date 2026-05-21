import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../src/auth.js';
import { config } from '../src/config.js';

function buildApp() {
  const app = new Hono();
  app.use('/protected/*', authMiddleware);
  app.get('/protected/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lets requests through when authEnabled is false', async () => {
    vi.spyOn(config, 'authEnabled', 'get').mockReturnValue(false);
    const app = buildApp();
    const res = await app.request('/protected/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 401 when x-api-key is missing and authEnabled is true', async () => {
    vi.spyOn(config, 'authEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config, 'apiKeys', 'get').mockReturnValue(['secret-test-key']);
    const app = buildApp();
    const res = await app.request('/protected/ping');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Missing x-api-key header' });
  });

  it('returns 401 when x-api-key does not match any configured key', async () => {
    vi.spyOn(config, 'authEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config, 'apiKeys', 'get').mockReturnValue(['secret-test-key']);
    const app = buildApp();
    const res = await app.request('/protected/ping', {
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid API key' });
  });

  it('lets requests through when the key matches', async () => {
    vi.spyOn(config, 'authEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config, 'apiKeys', 'get').mockReturnValue(['secret-test-key']);
    const app = buildApp();
    const res = await app.request('/protected/ping', {
      headers: { 'x-api-key': 'secret-test-key' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a key of a different length without crashing the timing-safe compare', async () => {
    vi.spyOn(config, 'authEnabled', 'get').mockReturnValue(true);
    vi.spyOn(config, 'apiKeys', 'get').mockReturnValue(['exact-length-key']);
    const app = buildApp();
    const res = await app.request('/protected/ping', {
      headers: { 'x-api-key': 'short' },
    });
    expect(res.status).toBe(401);
  });
});
