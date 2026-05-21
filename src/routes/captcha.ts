import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { CaptchaSolveRequest, CaptchaSolveResponse } from '../types.js';
import { getOwnedSession } from '../utils/session-auth.js';

export function captchaRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  app.post('/:id/captcha/solve', async (c) => {
    if (!config.CAPTCHA_API_KEY) {
      return c.json({ error: 'CAPTCHA solving not configured. Set CAPTCHA_API_KEY.' }, 501);
    }

    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e: any) {
      return c.json({ error: e.message }, e.status ?? 404);
    }

    const body = await c.req.json<CaptchaSolveRequest>().catch(() => ({}) as CaptchaSolveRequest);
    const page = await session.getPage();
    const start = Date.now();

    // Detect CAPTCHA type
    const detected = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      if (html.includes('g-recaptcha') || html.includes('recaptcha')) {
        const siteKey =
          document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') ?? '';
        return { type: 'recaptcha', siteKey };
      }
      if (html.includes('h-captcha') || html.includes('hcaptcha')) {
        const siteKey =
          document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') ?? '';
        return { type: 'hcaptcha', siteKey };
      }
      if (html.includes('cf-turnstile') || html.includes('turnstile')) {
        const siteKey =
          document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') ?? '';
        return { type: 'turnstile', siteKey };
      }
      return null;
    });

    if (!detected) {
      return c.json({
        success: false,
        type: 'none',
        duration: Date.now() - start,
        error: 'No CAPTCHA detected on page',
      } satisfies CaptchaSolveResponse);
    }

    const captchaType = body.type === 'auto' || !body.type ? detected.type : body.type;

    try {
      // Submit to 2captcha
      const pageUrl = page.url();
      const createUrl = `https://2captcha.com/in.php?key=${config.CAPTCHA_API_KEY}&method=userrecaptcha&googlekey=${detected.siteKey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;

      const createRes = await fetch(createUrl);
      const createData = (await createRes.json()) as any;

      if (createData.status !== 1) {
        return c.json({
          success: false,
          type: captchaType,
          duration: Date.now() - start,
          error: `2captcha error: ${createData.request}`,
        } satisfies CaptchaSolveResponse);
      }

      const taskId = createData.request;

      // Poll for solution (max 120 seconds)
      let solution = '';
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const resultUrl = `https://2captcha.com/res.php?key=${config.CAPTCHA_API_KEY}&action=get&id=${taskId}&json=1`;
        const resultRes = await fetch(resultUrl);
        const resultData = (await resultRes.json()) as any;

        if (resultData.status === 1) {
          solution = resultData.request;
          break;
        }
        if (resultData.request !== 'CAPCHA_NOT_READY') {
          return c.json({
            success: false,
            type: captchaType,
            duration: Date.now() - start,
            error: `2captcha error: ${resultData.request}`,
          } satisfies CaptchaSolveResponse);
        }
      }

      if (!solution) {
        return c.json({
          success: false,
          type: captchaType,
          duration: Date.now() - start,
          error: 'CAPTCHA solve timed out',
        } satisfies CaptchaSolveResponse);
      }

      // Inject solution
      await page.evaluate(
        (sol: string, type: string) => {
          if (type === 'recaptcha') {
            const textarea = document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement;
            if (textarea) {
              textarea.value = sol;
              textarea.style.display = 'block';
            }
            // Trigger callback
            if ((window as any).___grecaptcha_cfg?.clients) {
              for (const client of Object.values(
                (window as any).___grecaptcha_cfg.clients,
              ) as any[]) {
                for (const key of Object.keys(client)) {
                  const cb = client[key]?.callback;
                  if (typeof cb === 'function') cb(sol);
                }
              }
            }
          }
        },
        solution,
        captchaType,
      );

      logger.info(
        { sessionId: session.id, captchaType, duration: Date.now() - start },
        'CAPTCHA solved',
      );
      return c.json({
        success: true,
        type: captchaType,
        duration: Date.now() - start,
      } satisfies CaptchaSolveResponse);
    } catch (err: any) {
      return c.json({
        success: false,
        type: captchaType,
        duration: Date.now() - start,
        error: err.message,
      } satisfies CaptchaSolveResponse);
    }
  });

  return app;
}
