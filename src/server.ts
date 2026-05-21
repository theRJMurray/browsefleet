import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { config } from './config.js';
import { authMiddleware } from './auth.js';
import { rateLimitMiddleware } from './rate-limit.js';
import { BrowserPool } from './pool/browser-pool.js';
import { createCdpProxy } from './proxy/cdp-proxy.js';
import { sessionsRoutes } from './routes/sessions.js';
import { scrapeRoutes } from './routes/scrape.js';
import { screenshotRoutes } from './routes/screenshot.js';
import { pdfRoutes } from './routes/pdf.js';
import { actionsRoutes } from './routes/actions.js';
import { captchaRoutes } from './routes/captcha.js';
import { profilesRoutes } from './routes/profiles.js';
import { filesRoutes } from './routes/files.js';
import { agentRoutes } from './routes/agent.js';
import { closeDb } from './db/schema.js';
import { mkdirSync } from 'node:fs';

// ─── Logger ────────────────────────────────────────────────────────────────

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// ─── Data Directory ────────────────────────────────────────────────────────

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(`${config.dataDir}/profiles`, { recursive: true });

// ─── Browser Pool ──────────────────────────────────────────────────────────

export const pool = new BrowserPool();

// ─── Hono App ──────────────────────────────────────────────────────────────

const app = new Hono();

// Global middleware
app.use('*', secureHeaders());
app.use('*', cors({
  origin: ['https://browsefleet.com', 'http://localhost:3000'],
  allowHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
}));
app.use('*', bodyLimit({ maxSize: 10 * 1024 * 1024 })); // 10 MB
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms }, 'request');
});

// Health check (no auth)
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    activeSessions: pool.activeCount,
    maxSessions: config.MAX_CONCURRENT_SESSIONS,
    uptime: process.uptime(),
  });
});

// Auth middleware for all /v1 routes
app.use('/v1/*', authMiddleware);

// Rate limiting (after auth so apiKey is available)
app.use('/v1/*', rateLimitMiddleware());

// Routes
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

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  return c.json({ error: message }, 500);
});

// ─── Start Server ──────────────────────────────────────────────────────────

const server = serve({
  fetch: app.fetch,
  port: config.PORT,
  hostname: config.HOST,
}, (info) => {
  logger.info({
    port: info.port,
    host: config.HOST,
    auth: config.authEnabled ? 'enabled' : 'disabled',
    stealth: config.STEALTH_DEFAULT,
    maxSessions: config.MAX_CONCURRENT_SESSIONS,
  }, 'BrowseFleet started');
});

// CDP WebSocket proxy
const cdpProxy = createCdpProxy(pool);
(server as any).on('upgrade', cdpProxy);

// ─── Graceful Shutdown ─────────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down...');

  // Stop accepting new connections
  (server as any).close();

  // Release all browser sessions
  const released = await pool.shutdown();

  // Close the database
  closeDb();

  logger.info('All sessions released, exiting');

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.fatal({ error: err.message, stack: err.stack }, 'Uncaught exception');
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});
