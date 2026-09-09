import { Hono } from 'hono';
import type { KeyInput } from 'puppeteer-core';
import { errorMessage, errorStatus } from '../utils/errors.js';
import type { BrowserPool } from '../pool/browser-pool.js';
import type { ActionRequest, ActionResponse } from '../types.js';
import { validateUrl } from '../utils/url-validator.js';
import { getOwnedSession } from '../utils/session-auth.js';

export function actionsRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  app.post('/:id/actions', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e) {
      return c.json({ error: errorMessage(e) }, errorStatus(e) ?? 404);
    }

    const body = await c.req.json<ActionRequest>().catch(() => null);
    if (!body?.actions?.length) return c.json({ error: 'actions array is required' }, 400);

    const hasInputAction = body.actions.some(
      (action) => action.type !== 'screenshot' && action.type !== 'wait',
    );
    if (hasInputAction) {
      try {
        session.assertAgentControl();
      } catch (e) {
        return c.json({ error: errorMessage(e) }, errorStatus(e) ?? 423);
      }
    }

    const page = await session.getPage();
    const results: ActionResponse['results'] = [];

    for (const action of body.actions) {
      try {
        switch (action.type) {
          case 'screenshot': {
            if (session.sensitiveMode) {
              results.push({
                type: 'screenshot',
                success: false,
                error: 'Screenshot suppressed while sensitive mode is enabled',
              });
              break;
            }
            const ss = await page.screenshot({ encoding: 'base64', type: 'png' });
            results.push({ type: 'screenshot', success: true, screenshot: ss as string });
            break;
          }
          case 'click': {
            await page.mouse.click(action.x, action.y, {
              button: action.button ?? 'left',
              clickCount: action.clickCount ?? 1,
            });
            const ss = session.sensitiveMode
              ? undefined
              : ((await page.screenshot({ encoding: 'base64', type: 'png' })) as string);
            results.push({ type: 'click', success: true, screenshot: ss });
            break;
          }
          case 'type': {
            await page.keyboard.type(action.text, { delay: 30 });
            const ss = session.sensitiveMode
              ? undefined
              : ((await page.screenshot({ encoding: 'base64', type: 'png' })) as string);
            results.push({ type: 'type', success: true, screenshot: ss });
            break;
          }
          case 'press_key': {
            await page.keyboard.press(action.key as KeyInput);
            const ss = session.sensitiveMode
              ? undefined
              : ((await page.screenshot({ encoding: 'base64', type: 'png' })) as string);
            results.push({ type: 'press_key', success: true, screenshot: ss });
            break;
          }
          case 'scroll': {
            await page.mouse.wheel({ deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 0 });
            await new Promise((r) => setTimeout(r, 500));
            const ss = session.sensitiveMode
              ? undefined
              : ((await page.screenshot({ encoding: 'base64', type: 'png' })) as string);
            results.push({ type: 'scroll', success: true, screenshot: ss });
            break;
          }
          case 'move_mouse': {
            await page.mouse.move(action.x, action.y);
            results.push({ type: 'move_mouse', success: true });
            break;
          }
          case 'wait': {
            await new Promise((r) => setTimeout(r, Math.min(action.duration, 30_000)));
            results.push({ type: 'wait', success: true });
            break;
          }
          case 'navigate': {
            await validateUrl(action.url);
            await page.goto(action.url, { waitUntil: 'networkidle2', timeout: 30_000 });
            const ss = session.sensitiveMode
              ? undefined
              : ((await page.screenshot({ encoding: 'base64', type: 'png' })) as string);
            results.push({ type: 'navigate', success: true, screenshot: ss });
            break;
          }
          default:
            results.push({
              // `action` is `never` here: every member of the union has a case above. The
              // cast reads the type back off whatever a client actually sent.
              type: (action as { type: string }).type,
              success: false,
              error: 'Unknown action type',
            });
        }
      } catch (err) {
        results.push({ type: action.type, success: false, error: errorMessage(err) });
      }
    }

    return c.json({ results });
  });

  return app;
}
