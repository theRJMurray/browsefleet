import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as puppeteerCore from 'puppeteer-core';
import { v4 as uuid } from 'uuid';
import { BrowserSession } from './session.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { CreateSessionRequest } from '../types.js';
import type { Browser } from 'puppeteer-core';

puppeteer.use(StealthPlugin());

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { getStealthArgs, randomViewport, randomUserAgent } from '../stealth/stealth.js';
import { profileExists, profileUserDataDir, touchProfile } from '../routes/profiles.js';

function findChromeSync(): string {
  if (config.chromePath) return config.chromePath;

  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
          `${process.env.LOCALAPPDATA}/Chromium/Application/chrome.exe`,
        ]
      : [
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/snap/bin/chromium',
        ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return '';
}

export class BrowserPool {
  private sessions = new Map<string, BrowserSession>();
  private utilityBrowser: Browser | null = null;
  private chromePath: string;

  constructor() {
    this.chromePath = findChromeSync();
  }

  get activeCount(): number {
    return this.sessions.size;
  }

  private buildArgs(opts: CreateSessionRequest): string[] {
    const stealth = opts.stealth ?? config.STEALTH_DEFAULT;
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      ...getStealthArgs(stealth),
    ];

    if (opts.proxyUrl) {
      args.push(`--proxy-server=${opts.proxyUrl}`);
    } else if (config.PROXY_URL) {
      args.push(`--proxy-server=${config.PROXY_URL}`);
    }

    if (opts.blockAds) {
      // Basic ad blocking via Chrome flag
      args.push(
        '--host-resolver-rules=MAP *.doubleclick.net 0.0.0.0, MAP *.googlesyndication.com 0.0.0.0',
      );
    }

    return args;
  }

  async createSession(opts: CreateSessionRequest = {}, apiKey?: string): Promise<BrowserSession> {
    if (this.sessions.size >= config.MAX_CONCURRENT_SESSIONS) {
      throw new Error(`Maximum concurrent sessions (${config.MAX_CONCURRENT_SESSIONS}) reached`);
    }

    const id = opts.sessionId || uuid();

    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`);
    }

    const stealth = opts.stealth ?? config.STEALTH_DEFAULT;
    const viewport = opts.viewport ?? { width: 1280, height: 900 };
    const args = this.buildArgs(opts);
    const userDataDir = opts.profileId ? profileUserDataDir(opts.profileId) : undefined;

    if (opts.profileId) {
      if (!profileExists(opts.profileId)) {
        throw new Error(`Profile ${opts.profileId} not found`);
      }
      mkdirSync(userDataDir!, { recursive: true });
    }

    const launchOpts = {
      headless: opts.headless ?? true,
      args,
      executablePath: this.chromePath || undefined,
      defaultViewport: viewport,
      userDataDir,
      timeout: 30_000,
    };

    let browser: Browser;
    if (stealth === 'none') {
      browser = await puppeteerCore.launch(launchOpts);
    } else {
      browser = await (puppeteer as any).launch(launchOpts);
    }

    const cdpEndpoint = browser.wsEndpoint();
    if (opts.profileId) touchProfile(opts.profileId);

    const session = new BrowserSession(
      id,
      browser,
      cdpEndpoint,
      opts,
      () => {
        this.releaseSession(id).catch(() => {});
      },
      apiKey,
    );

    // Apply stealth fingerprinting when stealth is 'full'
    if (stealth === 'full') {
      const page = await session.getPage();
      if (!opts.userAgent) {
        await page.setUserAgent(randomUserAgent());
      }
      if (!opts.viewport) {
        await page.setViewport(randomViewport());
      }
    }

    // Set user agent if provided
    if (opts.userAgent) {
      const page = await session.getPage();
      await page.setUserAgent(opts.userAgent);
    }

    // Set extra headers if provided
    if (opts.headers) {
      const page = await session.getPage();
      await page.setExtraHTTPHeaders(opts.headers);
    }

    // Inject cookies if provided
    if (opts.cookies && opts.cookies.length > 0) {
      const page = await session.getPage();
      await page.setCookie(
        ...opts.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? '/',
        })),
      );
    }

    this.sessions.set(id, session);
    logger.info({ sessionId: id, stealth, viewport }, 'Session created');

    return session;
  }

  getSession(id: string): BrowserSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  async releaseSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    const browserHours = session.getBrowserHours();
    await session.release();
    this.sessions.delete(id);

    // Clean up temporary upload/download directories
    try {
      rmSync(`/tmp/bf-uploads-${id}`, { recursive: true, force: true });
    } catch {}
    try {
      rmSync(`/tmp/bf-downloads-${id}`, { recursive: true, force: true });
    } catch {}

    logger.info({ sessionId: id, browserHours: browserHours.toFixed(4) }, 'Session released');

    return true;
  }

  async releaseAll(): Promise<number> {
    const ids = Array.from(this.sessions.keys());
    let count = 0;
    for (const id of ids) {
      if (await this.releaseSession(id)) count++;
    }
    return count;
  }

  // Utility browser for quick actions (shared, not counted as a session)
  async getUtilityBrowser(): Promise<Browser> {
    if (this.utilityBrowser?.connected) {
      return this.utilityBrowser;
    }

    const args = this.buildArgs({});
    this.utilityBrowser = await (puppeteer as any).launch({
      headless: true,
      args,
      executablePath: this.chromePath || undefined,
      defaultViewport: { width: 1280, height: 900 },
      timeout: 30_000,
    });

    this.utilityBrowser!.on('disconnected', () => {
      this.utilityBrowser = null;
    });

    return this.utilityBrowser!;
  }

  // Run a quick action in an incognito context (fast, isolated)
  async withEphemeralContext<T>(
    fn: (page: puppeteerCore.Page) => Promise<T>,
    opts?: { proxyUrl?: string; stealth?: string; viewport?: { width: number; height: number } },
  ): Promise<T> {
    const browser = await this.getUtilityBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    if (opts?.viewport) {
      await page.setViewport(opts.viewport);
    }

    try {
      return await fn(page);
    } finally {
      await context.close().catch(() => {});
    }
  }

  async shutdown(): Promise<void> {
    await this.releaseAll();
    if (this.utilityBrowser) {
      await this.utilityBrowser.close().catch(() => {});
      this.utilityBrowser = null;
    }
  }
}
