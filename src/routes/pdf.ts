import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import type { PdfRequest } from '../types.js';
import { validateUrl } from '../utils/url-validator.js';

export function pdfRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  app.post('/pdf', async (c) => {
    const body = await c.req.json<PdfRequest>().catch(() => null);
    if (!body?.url) return c.json({ error: 'url is required' }, 400);

    try {
      await validateUrl(body.url);
      const result = await pool.withEphemeralContext(async (page) => {
        await page.goto(body.url, {
          waitUntil: 'networkidle2',
          timeout: Math.min(body.timeout ?? 30_000, 120_000),
        });

        if (typeof body.waitFor === 'string') {
          await page.waitForSelector(body.waitFor, { timeout: 10_000 }).catch(() => {});
        } else if (typeof body.waitFor === 'number') {
          await new Promise((r) => setTimeout(r, Math.min(body.waitFor as number, 30_000)));
        }

        const buf = await page.pdf({
          format: body.format ?? 'A4',
          landscape: body.landscape ?? false,
          printBackground: body.printBackground ?? true,
          margin: body.margin ?? { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
        });
        return Buffer.from(buf);
      });

      return new Response(result, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="page.pdf"',
        },
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
