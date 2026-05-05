import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import type { ControlSessionRequest, CreateSessionRequest, ReleaseRequest } from '../types.js';
import { getOwnedSession } from '../utils/session-auth.js';

export function sessionsRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  // Create session
  app.post('/', async (c) => {
    const body = await c.req.json<CreateSessionRequest>().catch(() => ({}));

    try {
      const apiKey = c.req.header('x-api-key');
      const session = await pool.createSession(body, apiKey);
      return c.json(session.toApiObject(), 201);
    } catch (err: any) {
      const status = err.message?.includes('Maximum') ? 429 : 500;
      return c.json({ error: err.message }, status);
    }
  });

  // List sessions (filtered by requesting API key)
  app.get('/', (c) => {
    const apiKey = c.req.header('x-api-key');
    const sessions = pool.listSessions()
      .filter(s => !s.apiKey || !apiKey || s.apiKey === apiKey)
      .map(s => s.toApiObject());
    return c.json({ sessions, count: sessions.length });
  });

  // Get session
  app.get('/:id', (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try { session = getOwnedSession(pool, c.req.param('id'), apiKey); }
    catch (e: any) { return c.json({ error: e.message }, e.status ?? 404); }
    return c.json(session.toApiObject());
  });

  // Release session
  app.post('/:id/release', async (c) => {
    const apiKey = c.req.header('x-api-key');
    try { getOwnedSession(pool, c.req.param('id'), apiKey); }
    catch (e: any) { return c.json({ error: e.message }, e.status ?? 404); }
    const released = await pool.releaseSession(c.req.param('id'));
    if (!released) return c.json({ error: 'Session not found' }, 404);
    return c.json({ released: true });
  });

  // Switch between agent automation, human takeover, and paused control.
  app.post('/:id/control', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try { session = getOwnedSession(pool, c.req.param('id'), apiKey); }
    catch (e: any) { return c.json({ error: e.message }, e.status ?? 404); }

    const body = await c.req.json<ControlSessionRequest>().catch(() => ({} as ControlSessionRequest));
    if (body.controlMode && !['agent', 'human', 'paused'].includes(body.controlMode)) {
      return c.json({ error: 'controlMode must be agent, human, or paused' }, 400);
    }

    if (body.controlMode) session.setControl(body.controlMode, body.reason);
    if (body.sensitiveMode !== undefined) session.setSensitiveMode(Boolean(body.sensitiveMode));

    return c.json(session.toApiObject());
  });

  // Release all or batch (only caller's sessions)
  app.post('/release', async (c) => {
    const apiKey = c.req.header('x-api-key');
    const body = await c.req.json<ReleaseRequest>().catch(() => ({} as ReleaseRequest));

    if (body.ids && body.ids.length > 0) {
      let count = 0;
      for (const id of body.ids) {
        try { getOwnedSession(pool, id, apiKey); }
        catch { continue; }
        if (await pool.releaseSession(id)) count++;
      }
      return c.json({ released: count });
    }

    // Release all sessions owned by this API key
    let count = 0;
    for (const s of pool.listSessions()) {
      if (!s.apiKey || !apiKey || s.apiKey === apiKey) {
        if (await pool.releaseSession(s.id)) count++;
      }
    }
    return c.json({ released: count });
  });

  // Live viewer (SSE — streams screenshots)
  app.get('/:id/live', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try { session = getOwnedSession(pool, c.req.param('id'), apiKey); }
    catch (e: any) { return c.json({ error: e.message }, e.status ?? 404); }

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    let liveInterval: ReturnType<typeof setInterval> | undefined;
    let liveTimeout: ReturnType<typeof setTimeout> | undefined;
    let liveRunning = true;
    let liveClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const close = () => {
          if (!liveClosed) {
            liveClosed = true;
            controller.close();
          }
        };

        liveInterval = setInterval(async () => {
          if (!liveRunning) return;
          try {
            const snapshot = await session.getSnapshot({ includeScreenshot: true, quality: 50 });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
          } catch {
            liveRunning = false;
            clearInterval(liveInterval);
            if (liveTimeout) clearTimeout(liveTimeout);
            close();
          }
        }, 500);

        // Cleanup after 5 minutes max
        liveTimeout = setTimeout(() => {
          liveRunning = false;
          clearInterval(liveInterval);
          close();
        }, 300_000);
      },
      cancel() {
        liveRunning = false;
        if (liveInterval) clearInterval(liveInterval);
        if (liveTimeout) clearTimeout(liveTimeout);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  // Operator event stream: metadata every second, screenshot unless sensitive mode is active.
  app.get('/:id/events', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try { session = getOwnedSession(pool, c.req.param('id'), apiKey); }
    catch (e: any) { return c.json({ error: e.message }, e.status ?? 404); }

    let interval: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const close = () => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        };

        interval = setInterval(async () => {
          try {
            const snapshot = await session.getSnapshot({ includeScreenshot: true, quality: 45 });
            controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
          } catch {
            if (interval) clearInterval(interval);
            close();
          }
        }, 1000);
      },
      cancel() {
        if (interval) clearInterval(interval);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  return app;
}
