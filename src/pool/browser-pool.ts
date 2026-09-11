import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as puppeteerCore from 'puppeteer-core';
import { v4 as uuid } from 'uuid';
import { validateSessionId } from './session-files.js';
import { BrowserSession } from './session.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { CreateSessionRequest } from '../types.js';
import type { Browser, BrowserContext, LaunchOptions } from 'puppeteer-core';

puppeteer.use(StealthPlugin());

import { existsSync, mkdirSync } from 'node:fs';
import { getStealthArgs, randomViewport, randomUserAgent } from '../stealth/stealth.js';
import { profileExists, profileUserDataDir, touchProfile } from '../routes/profiles.js';

/**
 * `puppeteer-extra` is typed against the full `puppeteer` package. Its `Browser` is a separate
 * declaration from `puppeteer-core`'s, so the compiler rejects the assignment even though the
 * two are the same object at runtime and this project deliberately depends on `puppeteer-core`
 * alone. Narrowing the plugin host to the single method used here states that mismatch once,
 * where it can be read, instead of scattering `as any` across the call sites.
 */
type StealthLauncher = { launch(options: LaunchOptions): Promise<Browser> };
const stealthLauncher = puppeteer as unknown as StealthLauncher;

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
  private pending = new Map<string, Promise<BrowserSession>>();
  private orphanBrowsers = new Map<string, Browser>();
  private releases = new Map<string, Promise<boolean>>();
  private failedContexts = new Set<BrowserContext>();
  private reservedIds = new Set<string>();
  private closing = false;
  private shutdownPromise: Promise<void> | undefined;
  private utilityLaunch: Promise<Browser> | undefined;
  private ephemeral = new Set<Promise<unknown>>();
  private utilityBrowser: Browser | null = null;
  private chromePath: string;

  constructor() {
    this.chromePath = findChromeSync();
  }

  get activeCount(): number {
    return this.sessions.size + this.orphanBrowsers.size;
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
    const id = opts.sessionId === undefined ? uuid() : opts.sessionId;
    validateSessionId(id);
    if (this.closing) throw new Error('Browser pool is shutting down');
    if (this.reservedIds.has(id) || this.sessions.has(id) || this.orphanBrowsers.has(id)) {
      throw Object.assign(new Error(`Session ${id} already exists`), { status: 409 });
    }
    if (this.activeCount + this.reservedIds.size >= config.MAX_CONCURRENT_SESSIONS) {
      throw new Error(`Maximum concurrent sessions (${config.MAX_CONCURRENT_SESSIONS}) reached`);
    }
    this.reservedIds.add(id);
    // Defer execution so shutdown can see the promise even when launch throws synchronously.
    const creation = Promise.resolve().then(() => this.launchSession(id, opts, apiKey));
    this.pending.set(id, creation);
    try {
      return await creation;
    } finally {
      this.reservedIds.delete(id);
      this.pending.delete(id);
    }
  }

  private async launchSession(
    id: string,
    opts: CreateSessionRequest,
    apiKey?: string,
  ): Promise<BrowserSession> {
    let browser: Browser | undefined;
    let session: BrowserSession | undefined;
    try {
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

      if (stealth === 'none') {
        browser = await puppeteerCore.launch(launchOpts);
      } else {
        browser = await stealthLauncher.launch(launchOpts);
      }

      const cdpEndpoint = browser.wsEndpoint();
      if (opts.profileId) touchProfile(opts.profileId);

      session = new BrowserSession(
        id,
        browser,
        cdpEndpoint,
        opts,
        () => {
          if (this.sessions.get(id) === session) this.releaseSession(id).catch(() => {});
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

      if (this.closing || session.status !== 'active') {
        throw new Error('Session ended before setup completed');
      }
      this.sessions.set(id, session);
      logger.info({ sessionId: id, stealth, viewport }, 'Session created');

      return session;
    } catch (error) {
      try {
        if (session) await session.release();
        else if (browser) await browser.close();
      } catch (cleanupError) {
        // Failed creation still owns a live browser until explicit release or shutdown retries.
        if (browser) this.orphanBrowsers.set(id, browser);
        throw new AggregateError([error, cleanupError], 'Session setup and browser cleanup failed');
      }
      throw error;
    }
  }

  getSession(id: string): BrowserSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  async releaseSession(id: string): Promise<boolean> {
    const pending = this.releases.get(id);
    if (pending) return pending;
    const session = this.sessions.get(id);
    const orphan = this.orphanBrowsers.get(id);
    if (!session && !orphan) return false;
    const release = Promise.resolve().then(async () => {
      if (session) await session.release();
      else await orphan!.close();
      if (this.sessions.get(id) === session) this.sessions.delete(id);
      if (this.orphanBrowsers.get(id) === orphan) this.orphanBrowsers.delete(id);
      logger.info({ sessionId: id }, 'Session released');
      return true;
    });
    this.releases.set(id, release);
    try {
      return await release;
    } finally {
      this.releases.delete(id);
    }
  }

  async releaseAll(): Promise<number> {
    const ids = new Set([...this.sessions.keys(), ...this.orphanBrowsers.keys()]);
    const results = await Promise.allSettled([...ids].map((id) => this.releaseSession(id)));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Browser cleanup failed',
      );
    return results.filter((result) => result.status === 'fulfilled' && result.value).length;
  }

  // Utility work has a separate ceiling equal to MAX_CONCURRENT_SESSIONS.
  async getUtilityBrowser(): Promise<Browser> {
    if (this.closing) throw new Error('Browser pool is shutting down');
    if (this.utilityBrowser?.connected) return this.utilityBrowser;
    if (this.utilityLaunch) return this.utilityLaunch;
    const launch = Promise.resolve().then(async () => {
      const browser = await stealthLauncher.launch({
        headless: true,
        args: this.buildArgs({}),
        executablePath: this.chromePath || undefined,
        defaultViewport: { width: 1280, height: 900 },
        timeout: 30_000,
      });
      try {
        if (this.closing) throw new Error('Browser pool is shutting down');
        browser.on('disconnected', () => {
          if (this.utilityBrowser === browser) this.utilityBrowser = null;
        });
        this.utilityBrowser = browser;
        return browser;
      } catch (error) {
        try {
          await browser.close();
        } catch (cleanupError) {
          this.utilityBrowser = browser;
          throw new AggregateError([error, cleanupError], 'Utility setup and cleanup failed');
        }
        throw error;
      }
    });
    this.utilityLaunch = launch;
    try {
      return await launch;
    } finally {
      if (this.utilityLaunch === launch) this.utilityLaunch = undefined;
    }
  }

  async withEphemeralContext<T>(
    fn: (page: puppeteerCore.Page) => Promise<T>,
    opts?: { proxyUrl?: string; stealth?: string; viewport?: { width: number; height: number } },
  ): Promise<T> {
    if (this.closing) throw new Error('Browser pool is shutting down');
    if (this.ephemeral.size + this.failedContexts.size >= config.MAX_CONCURRENT_SESSIONS) {
      throw new Error(
        `Maximum concurrent ephemeral contexts (${config.MAX_CONCURRENT_SESSIONS}) reached`,
      );
    }
    const work = Promise.resolve().then(async () => {
      const browser = await this.getUtilityBrowser();
      const context = await browser.createBrowserContext();
      let result!: T;
      let failed = false;
      let workError: unknown;
      try {
        const page = await context.newPage();
        if (opts?.viewport) await page.setViewport(opts.viewport);
        result = await fn(page);
      } catch (error) {
        failed = true;
        workError = error;
      }
      try {
        await context.close();
      } catch (error) {
        this.failedContexts.add(context);
        if (failed)
          throw new AggregateError([workError, error], 'Ephemeral work and cleanup failed');
        throw error;
      }
      if (failed) throw workError;
      return result;
    });
    this.ephemeral.add(work);
    try {
      return await work;
    } finally {
      this.ephemeral.delete(work);
    }
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closing = true;
    this.shutdownPromise = (async () => {
      await Promise.allSettled([...this.pending.values(), ...this.ephemeral, this.utilityLaunch]);
      const failures: unknown[] = [];
      try {
        await this.releaseAll();
      } catch (error) {
        failures.push(error);
      }
      // Closing the utility browser disposes all its failed contexts without disrupting work:
      // every admitted ephemeral operation has settled before this point.
      if (this.utilityBrowser) {
        try {
          await this.utilityBrowser.close();
          this.utilityBrowser = null;
          this.failedContexts.clear();
        } catch (error) {
          failures.push(error);
        }
      } else {
        for (const context of this.failedContexts) {
          try {
            await context.close();
            this.failedContexts.delete(context);
          } catch (error) {
            failures.push(error);
          }
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Pool shutdown cleanup failed');
    })().catch((error) => {
      this.shutdownPromise = undefined;
      throw error;
    });
    return this.shutdownPromise;
  }
}
