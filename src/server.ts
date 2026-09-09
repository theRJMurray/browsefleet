import { serve } from '@hono/node-server';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';
import { logger } from './logger.js';
import { createApp } from './app.js';
import { BrowserPool } from './pool/browser-pool.js';
import { createCdpProxy } from './proxy/cdp-proxy.js';
import { closeDb } from './db/schema.js';
import type { Server as HttpServer } from 'node:http';

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(`${config.dataDir}/profiles`, { recursive: true });

export const pool = new BrowserPool();

const app = createApp(pool);

const server = serve(
  {
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  },
  (info) => {
    logger.info(
      {
        port: info.port,
        host: config.HOST,
        auth: config.authEnabled ? 'enabled' : 'disabled',
        stealth: config.STEALTH_DEFAULT,
        maxSessions: config.MAX_CONCURRENT_SESSIONS,
      },
      'BrowseFleet started',
    );
  },
);

// `serve()` is typed as returning a generic server; the Node adapter always hands back an
// http.Server, and the CDP proxy needs its `upgrade` event to hijack the WebSocket handshake.
const httpServer = server as unknown as HttpServer;

const cdpProxy = createCdpProxy(pool);
httpServer.on('upgrade', cdpProxy);

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down...');
  httpServer.close();
  await pool.shutdown();
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
