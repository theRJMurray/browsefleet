import { WebSocket, WebSocketServer } from 'ws';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { BrowserPool } from '../pool/browser-pool.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function createCdpProxy(
  pool: BrowserPool,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({ noServer: true });

  return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Extract session ID from /cdp/:sessionId
    const match = url.pathname.match(/^\/cdp\/([a-zA-Z0-9-]+)/);
    if (!match) {
      socket.destroy();
      return;
    }

    const sessionId = match[1];

    // Auth check — apiKey in query string is necessary for WebSocket clients
    // that cannot set custom HTTP headers (e.g. browser WebSocket API)
    if (config.authEnabled) {
      const apiKey = url.searchParams.get('apiKey') ?? (req.headers['x-api-key'] as string);
      // Strip apiKey from logged URL to avoid leaking credentials
      const logUrl = new URL(url.toString());
      logUrl.searchParams.delete('apiKey');
      logger.debug({ url: logUrl.toString() }, 'CDP upgrade request');
      const keyValid =
        apiKey &&
        config.apiKeys.some((k) => {
          const a = Buffer.from(apiKey);
          const b = Buffer.from(k);
          return a.length === b.length && timingSafeEqual(a, b);
        });
      if (!keyValid) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const session = pool.getSession(sessionId);
    if (!session) {
      socket.write('HTTP/1.1 404 Session Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Connect to Chrome's actual CDP endpoint
    const chromeWs = new WebSocket(session.cdpEndpoint);

    chromeWs.on('open', () => {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        logger.debug({ sessionId }, 'CDP proxy connected');

        // Pipe messages bidirectionally
        clientWs.on('message', (data) => {
          if (chromeWs.readyState === WebSocket.OPEN) {
            chromeWs.send(data);
          }
        });

        chromeWs.on('message', (data) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data);
          }
        });

        clientWs.on('close', () => {
          chromeWs.close();
        });

        chromeWs.on('close', () => {
          clientWs.close();
        });

        clientWs.on('error', () => chromeWs.close());
        chromeWs.on('error', () => clientWs.close());
      });
    });

    chromeWs.on('error', (err) => {
      logger.error({ sessionId, error: err.message }, 'CDP proxy Chrome connection error');
      socket.destroy();
    });
  };
}
