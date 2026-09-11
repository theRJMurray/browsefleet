import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'puppeteer-core';
const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('puppeteer-core', () => ({ launch: mocks.launch }));
vi.mock('puppeteer-extra', () => ({ default: { use: vi.fn(), launch: mocks.launch } }));
vi.mock('puppeteer-extra-plugin-stealth', () => ({ default: vi.fn() }));
vi.mock('../src/routes/profiles.js', () => ({
  profileExists: vi.fn(() => true),
  profileUserDataDir: vi.fn(),
  touchProfile: vi.fn(),
}));
import { BrowserPool } from '../src/pool/browser-pool.js';
import { BrowserSession } from '../src/pool/session.js';
import { config } from '../src/config.js';
import { sessionsRoutes } from '../src/routes/sessions.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fakeBrowser() {
  const page = {
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setViewport: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    setCookie: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    pages: vi.fn().mockResolvedValue([page]),
    newPage: vi.fn().mockResolvedValue(page),
    wsEndpoint: vi.fn(() => 'ws://fake'),
    close: vi.fn().mockResolvedValue(undefined),
    connected: true,
    on: vi.fn(),
    createBrowserContext: vi.fn().mockResolvedValue(context),
  };
  return { browser, page, context, value: browser as unknown as Browser };
}
let pools: BrowserPool[] = [];
const pool = () => {
  const p = new BrowserPool();
  pools.push(p);
  return p;
};
beforeEach(() => {
  vi.useFakeTimers();
  mocks.launch.mockReset();
  vi.spyOn(config, 'MAX_CONCURRENT_SESSIONS', 'get').mockReturnValue(2);
});
afterEach(async () => {
  await Promise.all(pools.map((p) => p.shutdown()));
  pools = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('session cleanup', () => {
  it('expires and closes Chrome once, retaining expired status', async () => {
    const f = fakeBrowser();
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    const s = await p.createSession({ timeout: 10, stealth: 'none' });
    await vi.advanceTimersByTimeAsync(10);
    expect(s.status).toBe('expired');
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    expect(p.activeCount).toBe(0);
    await s.release();
    await p.shutdown();
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('concurrent explicit release waits for the same close and cancels expiry', async () => {
    const f = fakeBrowser();
    const gate = deferred<void>();
    f.browser.close.mockReturnValue(gate.promise);
    const expire = vi.fn();
    const s = new BrowserSession('test', f.value, 'ws://fake', { timeout: 10 }, expire);
    let done = 0;
    const a = s.release().then(() => done++);
    const b = s.release().then(() => done++);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(0);
    expect(expire).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([a, b]);
    await s.release();
    expect(done).toBe(2);
    expect(s.status).toBe('released');
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('keeps capacity and ID occupied until close completes', async () => {
    const f = fakeBrowser();
    const gate = deferred<void>();
    f.browser.close.mockReturnValue(gate.promise);
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    await p.createSession({ sessionId: 'held', stealth: 'none' });
    const a = p.releaseSession('held');
    const b = p.releaseSession('held');
    await expect(p.createSession({ sessionId: 'held' })).rejects.toThrow('already exists');
    expect(p.activeCount).toBe(1);
    gate.resolve();
    await Promise.all([a, b]);
    expect(p.activeCount).toBe(0);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('shutdown closes every registered browser and is idempotent', async () => {
    const a = fakeBrowser(),
      b = fakeBrowser();
    mocks.launch.mockResolvedValueOnce(a.value).mockResolvedValueOnce(b.value);
    const p = pool();
    await p.createSession({ stealth: 'none' });
    await p.createSession({ stealth: 'none' });
    await Promise.all([p.shutdown(), p.shutdown()]);
    expect(p.activeCount).toBe(0);
    expect(a.browser.close).toHaveBeenCalledTimes(1);
    expect(b.browser.close).toHaveBeenCalledTimes(1);
  });
});

describe('admission and failed launch', () => {
  it('reserves capacity and duplicate IDs before the first launch await', async () => {
    const a = deferred<Browser>(),
      b = deferred<Browser>();
    const fa = fakeBrowser(),
      fb = fakeBrowser();
    mocks.launch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const p = pool();
    const one = p.createSession({ sessionId: 'one', stealth: 'none' });
    await expect(p.createSession({ sessionId: 'one' })).rejects.toThrow('already exists');
    const two = p.createSession({ sessionId: 'two', stealth: 'none' });
    await expect(p.createSession({ sessionId: 'three' })).rejects.toThrow('Maximum');
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    a.resolve(fa.value);
    b.resolve(fb.value);
    await Promise.all([one, two]);
    expect(p.activeCount).toBe(2);
  });
  it('frees the reservation after launch rejection so the same ID can retry', async () => {
    mocks.launch
      .mockRejectedValueOnce(new Error('launch failed'))
      .mockResolvedValueOnce(fakeBrowser().value);
    const p = pool();
    await expect(p.createSession({ sessionId: 'retry', stealth: 'none' })).rejects.toThrow(
      'launch failed',
    );
    expect((await p.createSession({ sessionId: 'retry', stealth: 'none' })).id).toBe('retry');
  });
  it.each([
    'wsEndpoint',
    'pages',
    'setUserAgent',
    'setViewport',
    'setExtraHTTPHeaders',
    'setCookie',
  ])('closes Chrome on %s setup failure and permits retry', async (stage) => {
    const f = fakeBrowser();
    if (stage === 'wsEndpoint')
      f.browser.wsEndpoint.mockImplementation(() => {
        throw new Error('setup');
      });
    else if (stage === 'pages') f.browser.pages.mockRejectedValue(new Error('setup'));
    else f.page[stage as keyof typeof f.page].mockRejectedValue(new Error('setup'));
    mocks.launch.mockResolvedValueOnce(f.value).mockResolvedValueOnce(fakeBrowser().value);
    const p = pool();
    await expect(
      p.createSession({
        sessionId: 'retry',
        stealth: 'full',
        headers: { test: 'yes' },
        cookies: [{ name: 'x', value: 'y', domain: 'example.com' }],
      }),
    ).rejects.toThrow('setup');
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    expect(p.activeCount).toBe(0);
    await p.createSession({ sessionId: 'retry', stealth: 'none' });
  });
  it('retains reservation during failed-setup cleanup', async () => {
    const f = fakeBrowser(),
      close = deferred<void>();
    f.browser.wsEndpoint.mockImplementation(() => {
      throw new Error('setup');
    });
    f.browser.close.mockReturnValue(close.promise);
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    const creating = p.createSession({ sessionId: 'held', stealth: 'none' });
    const rejected = expect(creating).rejects.toThrow('setup');
    await vi.advanceTimersByTimeAsync(0);
    await expect(p.createSession({ sessionId: 'held' })).rejects.toThrow('already exists');
    close.resolve();
    await rejected;
  });
  it('does not register a session that expires while setup awaits', async () => {
    const f = fakeBrowser(),
      setup = deferred<void>();
    f.page.setUserAgent.mockReturnValue(setup.promise);
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    const creating = p.createSession({
      sessionId: 'expired',
      stealth: 'none',
      userAgent: 'test',
      timeout: 10,
    });
    const rejected = expect(creating).rejects.toThrow('ended');
    await vi.advanceTimersByTimeAsync(10);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    setup.resolve();
    await rejected;
    expect(p.activeCount).toBe(0);
  });
  it('shutdown drains a pending launch and prevents late registration or new admission', async () => {
    const gate = deferred<Browser>(),
      f = fakeBrowser();
    mocks.launch.mockReturnValue(gate.promise);
    const p = pool();
    const creating = p.createSession({ stealth: 'none' });
    const rejected = expect(creating).rejects.toThrow('ended');
    const shutdown = p.shutdown();
    await expect(p.createSession()).rejects.toThrow('shutting down');
    gate.resolve(f.value);
    await rejected;
    await shutdown;
    expect(p.activeCount).toBe(0);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    '',
    '../outside',
    'x/../../audit-target',
    'x\\..\\outside',
    '/absolute',
    'C:\\outside',
    'a:b',
    '%2f',
    '.',
    '..',
    'a'.repeat(129),
    42,
    null,
    {},
    ['valid'],
  ])('rejects malformed ID %j before launch', async (sessionId) => {
    const p = pool();
    const app = sessionsRoutes(p);
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(response.status).toBe(400);
    expect(mocks.launch).not.toHaveBeenCalled();
  });
});

describe('failed cleanup ownership', () => {
  it('retains session ID and capacity on close rejection and permits cleanup retry', async () => {
    vi.spyOn(config, 'MAX_CONCURRENT_SESSIONS', 'get').mockReturnValue(1);
    const f = fakeBrowser();
    f.browser.close.mockRejectedValueOnce(new Error('close failed'));
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    const s = await p.createSession({ sessionId: 'owned', stealth: 'none' });
    await expect(p.releaseSession('owned')).rejects.toThrow('close failed');
    expect(p.activeCount).toBe(1);
    expect(f.browser.connected).toBe(true);
    await expect(p.createSession({ sessionId: 'owned' })).rejects.toThrow('already exists');
    await expect(p.createSession({ sessionId: 'other' })).rejects.toThrow('Maximum');
    await p.releaseSession('owned');
    expect(p.activeCount).toBe(0);
    expect(f.browser.close).toHaveBeenCalledTimes(2);
    expect(s.status).toBe('released');
  });
  it.each(['wsEndpoint', 'setUserAgent'])(
    'keeps failed-setup browser ownership after close rejection at %s',
    async (stage) => {
      vi.spyOn(config, 'MAX_CONCURRENT_SESSIONS', 'get').mockReturnValue(1);
      const f = fakeBrowser();
      if (stage === 'wsEndpoint')
        f.browser.wsEndpoint.mockImplementation(() => {
          throw new Error('setup');
        });
      else f.page.setUserAgent.mockRejectedValue(new Error('setup'));
      f.browser.close.mockRejectedValueOnce(new Error('close failed'));
      mocks.launch.mockResolvedValue(f.value);
      const p = pool();
      await expect(
        p.createSession({ sessionId: 'failed', stealth: 'none', userAgent: 'test' }),
      ).rejects.toThrow('cleanup failed');
      expect(p.activeCount).toBe(1);
      await expect(p.createSession({ sessionId: 'failed' })).rejects.toThrow('already exists');
      await expect(p.createSession({ sessionId: 'other' })).rejects.toThrow('Maximum');
      await p.shutdown();
      expect(p.activeCount).toBe(0);
      expect(f.browser.close).toHaveBeenCalledTimes(2);
    },
  );
  it('shutdown attempts every browser despite rejection and can be retried', async () => {
    const a = fakeBrowser(),
      b = fakeBrowser();
    a.browser.close.mockRejectedValueOnce(new Error('close failed'));
    mocks.launch.mockResolvedValueOnce(a.value).mockResolvedValueOnce(b.value);
    const p = pool();
    await p.createSession({ stealth: 'none' });
    await p.createSession({ stealth: 'none' });
    await expect(p.shutdown()).rejects.toThrow('cleanup failed');
    expect(p.activeCount).toBe(1);
    expect(b.browser.close).toHaveBeenCalledTimes(1);
    await p.shutdown();
    expect(p.activeCount).toBe(0);
    expect(a.browser.close).toHaveBeenCalledTimes(2);
  });
  it('failed context close retains the live-context bound until shutdown disposes the browser', async () => {
    vi.spyOn(config, 'MAX_CONCURRENT_SESSIONS', 'get').mockReturnValue(1);
    const f = fakeBrowser();
    let live = 0;
    f.browser.createBrowserContext.mockImplementation(async () => {
      live++;
      return f.context;
    });
    f.context.close.mockRejectedValue(new Error('context close failed'));
    f.browser.close.mockImplementation(async () => {
      live = 0;
    });
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    await expect(p.withEphemeralContext(async () => 42)).rejects.toThrow('context close failed');
    expect(live).toBe(1);
    for (let i = 0; i < 4; i++)
      await expect(p.withEphemeralContext(async () => 42)).rejects.toThrow('Maximum');
    expect(live).toBe(1);
    expect(f.browser.createBrowserContext).toHaveBeenCalledTimes(1);
    await p.shutdown();
    expect(live).toBe(0);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('failed-context shutdown retains utility ownership when browser close also fails', async () => {
    const f = fakeBrowser();
    f.context.close.mockRejectedValue(new Error('context close failed'));
    f.browser.close.mockRejectedValueOnce(new Error('browser close failed'));
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    await expect(p.withEphemeralContext(async () => 42)).rejects.toThrow('context close failed');
    await expect(p.shutdown()).rejects.toThrow('cleanup failed');
    await p.shutdown();
    expect(f.browser.close).toHaveBeenCalledTimes(2);
  });
});

describe('utility lifecycle', () => {
  it('shares one pending utility launch', async () => {
    const gate = deferred<Browser>(),
      f = fakeBrowser();
    mocks.launch.mockReturnValue(gate.promise);
    const p = pool();
    const a = p.getUtilityBrowser(),
      b = p.getUtilityBrowser();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    gate.resolve(f.value);
    expect(await a).toBe(await b);
    await p.shutdown();
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('retries utility launch after rejection', async () => {
    const f = fakeBrowser();
    mocks.launch.mockRejectedValueOnce(new Error('launch')).mockResolvedValueOnce(f.value);
    const p = pool();
    await expect(p.getUtilityBrowser()).rejects.toThrow('launch');
    expect(await p.getUtilityBrowser()).toBe(f.value);
  });
  it.each(['newPage', 'viewport', 'callback'])(
    'closes ephemeral context on %s failure',
    async (stage) => {
      const f = fakeBrowser();
      if (stage === 'newPage') f.context.newPage.mockRejectedValue(new Error('setup'));
      if (stage === 'viewport') f.page.setViewport.mockRejectedValue(new Error('setup'));
      mocks.launch.mockResolvedValue(f.value);
      const p = pool();
      await expect(
        p.withEphemeralContext(
          async () => {
            throw new Error('setup');
          },
          { viewport: { width: 1, height: 1 } },
        ),
      ).rejects.toThrow('setup');
      expect(f.context.close).toHaveBeenCalledTimes(1);
    },
  );
  it('bounds ephemeral admission across awaits and releases slots after completion', async () => {
    const f = fakeBrowser(),
      gate = deferred<void>();
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    const a = p.withEphemeralContext(() => gate.promise),
      b = p.withEphemeralContext(() => gate.promise);
    await expect(p.withEphemeralContext(async () => {})).rejects.toThrow('Maximum');
    gate.resolve();
    await Promise.all([a, b]);
    await p.withEphemeralContext(async () => {});
    expect(f.context.close).toHaveBeenCalledTimes(3);
  });
  it('releases an ephemeral slot after context creation fails', async () => {
    const f = fakeBrowser();
    f.browser.createBrowserContext.mockRejectedValueOnce(new Error('context failed'));
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    await expect(p.withEphemeralContext(async () => {})).rejects.toThrow('context failed');
    await p.withEphemeralContext(async () => {});
    expect(f.context.close).toHaveBeenCalledTimes(1);
  });
  it('an old disconnected event cannot discard a replacement utility browser', async () => {
    const first = fakeBrowser(),
      second = fakeBrowser();
    mocks.launch.mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value);
    const p = pool();
    await p.getUtilityBrowser();
    const disconnected = first.browser.on.mock.calls[0][1] as () => void;
    first.browser.connected = false;
    expect(await p.getUtilityBrowser()).toBe(second.value);
    disconnected();
    expect(await p.getUtilityBrowser()).toBe(second.value);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });
  it('closes a utility browser if listener setup fails', async () => {
    const f = fakeBrowser();
    f.browser.on.mockImplementation(() => {
      throw new Error('listener failed');
    });
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    await expect(p.getUtilityBrowser()).rejects.toThrow('listener failed');
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('shutdown waits for admitted ephemeral work and rejects more work', async () => {
    const f = fakeBrowser(),
      gate = deferred<void>();
    mocks.launch.mockResolvedValue(f.value);
    const p = pool();
    const work = p.withEphemeralContext(() => gate.promise);
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const shutdown = p.shutdown().then(() => {
      stopped = true;
    });
    await expect(p.withEphemeralContext(async () => {})).rejects.toThrow('shutting down');
    expect(stopped).toBe(false);
    expect(f.browser.close).not.toHaveBeenCalled();
    gate.resolve();
    await work;
    await shutdown;
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
  it('closes utility launch resolved during shutdown', async () => {
    const gate = deferred<Browser>(),
      f = fakeBrowser();
    mocks.launch.mockReturnValue(gate.promise);
    const p = pool();
    const work = p.getUtilityBrowser();
    const rejected = expect(work).rejects.toThrow('shutting down');
    const shutdown = p.shutdown();
    gate.resolve(f.value);
    await rejected;
    await shutdown;
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });
});
