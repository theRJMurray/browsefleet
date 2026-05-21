import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { authMiddleware } from './auth.js';
import { rateLimitMiddleware } from './rate-limit.js';
import type { BrowserPool } from './pool/browser-pool.js';

// Read version from package.json at module load so release-please bumps
// are reflected in /health without needing a second file to edit.
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkgVersion = (JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }).version;
import { sessionsRoutes } from './routes/sessions.js';
import { scrapeRoutes } from './routes/scrape.js';
import { screenshotRoutes } from './routes/screenshot.js';
import { pdfRoutes } from './routes/pdf.js';
import { actionsRoutes } from './routes/actions.js';
import { captchaRoutes } from './routes/captcha.js';
import { profilesRoutes } from './routes/profiles.js';
import { filesRoutes } from './routes/files.js';
import { agentRoutes } from './routes/agent.js';

export function createApp(pool: BrowserPool): Hono {
  const app = new Hono();

  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: ['https://browsefleet.com', 'http://localhost:3000'],
      allowHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
    }),
  );
  app.use('*', bodyLimit({ maxSize: 10 * 1024 * 1024 }));
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms }, 'request');
  });

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: pkgVersion,
      activeSessions: pool.activeCount,
      maxSessions: config.MAX_CONCURRENT_SESSIONS,
      uptime: process.uptime(),
    });
  });

  app.use('/v1/*', authMiddleware);
  app.use('/v1/*', rateLimitMiddleware());

  app.route('/v1/sessions', sessionsRoutes(pool));
  app.route('/v1', scrapeRoutes(pool));
  app.route('/v1', screenshotRoutes(pool));
  app.route('/v1', pdfRoutes(pool));
  app.route('/v1/sessions', actionsRoutes(pool));
  app.route('/v1/sessions', captchaRoutes(pool));
  app.route('/v1/profiles', profilesRoutes());
  app.route('/v1/sessions', filesRoutes(pool));
  app.route('/v1/agent', agentRoutes(pool));
  app.route('/v1/sessions', agentRoutes(pool));

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((err, c) => {
    logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
    const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
    return c.json({ error: message }, 500);
  });

  return app;
}
