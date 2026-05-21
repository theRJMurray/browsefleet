import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import type { ScreenshotRequest } from '../types.js';
import { validateUrl } from '../utils/url-validator.js';

export function screenshotRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  app.post('/screenshot', async (c) => {
    const body = await c.req.json<ScreenshotRequest>().catch(() => null);
    if (!body?.url) return c.json({ error: 'url is required' }, 400);

    try {
      await validateUrl(body.url);
      const result = await pool.withEphemeralContext(async (page) => {
        if (body.viewport) {
          await page.setViewport(body.viewport);
        }

        await page.goto(body.url, {
          waitUntil: 'networkidle2',
          timeout: Math.min(body.timeout ?? 30_000, 120_000),
        });

        if (typeof body.waitFor === 'string') {
          await page.waitForSelector(body.waitFor, { timeout: 10_000 }).catch(() => {});
        } else if (typeof body.waitFor === 'number') {
          await new Promise((r) => setTimeout(r, Math.min(body.waitFor as number, 30_000)));
        }

        const format = body.format ?? 'png';
        const opts: any = {
          type: format,
          fullPage: body.fullPage ?? false,
          encoding: 'binary',
        };
        if (format === 'jpeg' && body.quality) {
          opts.quality = body.quality;
        }

        const data = await page.screenshot(opts);
        return data as unknown as Uint8Array;
      });

      const accept = c.req.header('accept') ?? '';
      if (accept.includes('application/json')) {
        return c.json({
          screenshot: Buffer.from(result).toString('base64'),
          format: body.format ?? 'png',
        });
      }

      const mime =
        body.format === 'jpeg' ? 'image/jpeg' : body.format === 'webp' ? 'image/webp' : 'image/png';
      return new Response(Buffer.from(result), { headers: { 'Content-Type': mime } });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
