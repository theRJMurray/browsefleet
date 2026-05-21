import { Hono } from 'hono';
import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import type { BrowserPool } from '../pool/browser-pool.js';
import { getOwnedSession } from '../utils/session-auth.js';

export function filesRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  // Upload file to session
  app.post('/:id/files', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e: any) {
      return c.json({ error: e.message }, e.status ?? 404);
    }

    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'file field is required (multipart)' }, 400);
    }

    const dir = `/tmp/bf-uploads-${session.id}`;
    mkdirSync(dir, { recursive: true });

    const safeName = path.basename(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(`${dir}/${safeName}`, buffer);

    return c.json({ uploaded: safeName, size: buffer.length });
  });

  // List files
  app.get('/:id/files', (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e: any) {
      return c.json({ error: e.message }, e.status ?? 404);
    }

    const uploadDir = `/tmp/bf-uploads-${session.id}`;
    const downloadDir = `/tmp/bf-downloads-${session.id}`;

    const files: string[] = [];
    if (existsSync(uploadDir)) files.push(...readdirSync(uploadDir).map((f) => `uploads/${f}`));
    if (existsSync(downloadDir))
      files.push(...readdirSync(downloadDir).map((f) => `downloads/${f}`));

    return c.json({ files });
  });

  // Download file
  app.get('/:id/files/:name', (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e: any) {
      return c.json({ error: e.message }, e.status ?? 404);
    }

    const name = path.basename(c.req.param('name'));

    // Check uploads first, then downloads
    for (const dir of [`/tmp/bf-uploads-${session.id}`, `/tmp/bf-downloads-${session.id}`]) {
      const path = `${dir}/${name}`;
      if (existsSync(path)) {
        const data = readFileSync(path);
        return new Response(data, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${name}"`,
          },
        });
      }
    }

    return c.json({ error: 'File not found' }, 404);
  });

  return app;
}
