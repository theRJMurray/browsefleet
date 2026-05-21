import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import type { ScrapeRequest } from '../types.js';
import { extractContent } from '../extract/content.js';
import { validateUrl } from '../utils/url-validator.js';

export function scrapeRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  app.post('/scrape', async (c) => {
    const body = await c.req.json<ScrapeRequest>().catch(() => null);
    if (!body?.url) return c.json({ error: 'url is required' }, 400);

    try {
      await validateUrl(body.url);
      const result = await pool.withEphemeralContext(async (page) => {
        if (body.cookies?.length) {
          await page.setCookie(...body.cookies.map((ck) => ({ ...ck, path: '/' })));
        }
        if (body.headers) {
          await page.setExtraHTTPHeaders(body.headers);
        }

        const response = await page.goto(body.url, {
          waitUntil: 'networkidle2',
          timeout: Math.min(body.timeout ?? 30_000, 120_000),
        });

        if (typeof body.waitFor === 'string') {
          await page.waitForSelector(body.waitFor, { timeout: 10_000 }).catch(() => {});
        } else if (typeof body.waitFor === 'number') {
          await new Promise((r) => setTimeout(r, Math.min(body.waitFor as number, 30_000)));
        }

        const html = await page.content();
        const url = page.url();
        const statusCode = response?.status() ?? 0;
        const extracted = extractContent(html, url);

        return { url, statusCode, html, ...extracted };
      });

      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}
