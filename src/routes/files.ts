import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import { getOwnedSession } from '../utils/session-auth.js';
import { errorMessage, errorStatus } from '../utils/errors.js';

export function filesRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  // Upload file to session
  app.post('/:id/files', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e) {
      return c.json({ error: errorMessage(e) }, errorStatus(e) ?? 404);
    }

    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'file field is required (multipart)' }, 400);
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      session.files.write(file.name, buffer);
      return c.json({ uploaded: file.name, size: buffer.length });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, errorStatus(error) ?? 500);
    }
  });

  // List files
  app.get('/:id/files', (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e) {
      return c.json({ error: errorMessage(e) }, errorStatus(e) ?? 404);
    }

    try {
      return c.json({ files: session.files.list() });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, errorStatus(error) ?? 500);
    }
  });

  // Download file
  app.get('/:id/files/:name', (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e) {
      return c.json({ error: errorMessage(e) }, errorStatus(e) ?? 404);
    }

    const name = c.req.param('name');
    try {
      const data = session.files.read(name);
      if (data) {
        return new Response(new Uint8Array(data), {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          },
        });
      }
      return c.json({ error: 'File not found' }, 404);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, errorStatus(error) ?? 500);
    }
  });

  return app;
}
