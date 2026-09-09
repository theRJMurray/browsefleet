import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Page } from 'puppeteer-core';
import { runAgent } from '../src/agent/agent.js';
import type { AgentAction, AgentStep } from '../src/agent/agent.js';
import { agentRoutes } from '../src/routes/agent.js';
import type { BrowserPool } from '../src/pool/browser-pool.js';

/**
 * These tests drive the real `runAgent` loop and the real streaming route. Nothing is
 * reimplemented for the test: the only things replaced are the two that would otherwise reach
 * the outside world, the LLM (via `fetch`) and Chrome (via a recording `Page` double).
 *
 * The reason to test at that seam rather than against hand-made `{ actions, reasoning }` objects
 * is that the response parser sits between the two, and it is where the interesting failures
 * live. A model that answers with prose instead of JSON is a case a fixture can never produce.
 */

// --- Doubles ---------------------------------------------------------------

type PageCall = { method: string; args: unknown[] };

function recordingPage(): { page: Page; calls: PageCall[] } {
  const calls: PageCall[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
    };

  const page = {
    screenshot: async () => 'ZmFrZS1zY3JlZW5zaG90', // "fake-screenshot" in base64
    goto: record('goto'),
    mouse: {
      click: record('mouse.click'),
      wheel: record('mouse.wheel'),
    },
    keyboard: {
      type: record('keyboard.type'),
      press: record('keyboard.press'),
    },
  } as unknown as Page;

  return { page, calls };
}

/** An Anthropic messages response carrying `text` as the model's reply. */
function anthropicReply(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Queue one canned model reply per iteration. The last reply repeats if the loop runs on. */
function stubModel(replies: string[]): { fetchMock: ReturnType<typeof vi.fn> } {
  let i = 0;
  const fetchMock = vi.fn(async () => {
    const text = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return anthropicReply(text);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock };
}

const DONE = JSON.stringify({
  reasoning: 'The answer is on screen',
  actions: [{ type: 'done', result: '42' }],
});

const request = { task: 'find the answer', provider: 'anthropic' as const, apiKey: 'test-key' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- The loop --------------------------------------------------------------

describe('runAgent', () => {
  it('returns the result the model reported done with, and tags no failure', async () => {
    stubModel([DONE]);
    const { page } = recordingPage();

    const result = await runAgent(page, request);

    expect(result.success).toBe(true);
    expect(result.result).toBe('42');
    expect(result.failure).toBeUndefined();
    expect(result.totalIterations).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].screenshot).toBe('ZmFrZS1zY3JlZW5zaG90');
  });

  it('executes the actions the model asked for, against the page, in order', async () => {
    stubModel([
      JSON.stringify({
        reasoning: 'fill the box',
        actions: [
          { type: 'click', x: 120, y: 340 },
          { type: 'type', text: 'hello' },
          { type: 'press_key', key: 'Enter' },
        ],
      }),
      DONE,
    ]);
    const { page, calls } = recordingPage();

    await runAgent(page, request);

    expect(calls.map((c) => c.method)).toEqual(['mouse.click', 'keyboard.type', 'keyboard.press']);
    expect(calls[0].args.slice(0, 2)).toEqual([120, 340]);
    expect(calls[1].args[0]).toBe('hello');
    expect(calls[2].args[0]).toBe('Enter');
  });

  it('treats an unparseable model response as a failure rather than an empty step', async () => {
    // The exact case the old streaming implementation swallowed: it produced zero actions,
    // recorded nothing, and spun to the iteration ceiling with no explanation.
    stubModel(['I had a look around and I think you should try clicking the blue button.']);
    const { page } = recordingPage();

    const result = await runAgent(page, request);

    expect(result.success).toBe(false);
    expect(result.failure).toBe('agent_fail');
    expect(result.error).toMatch(/Could not parse/i);
    expect(result.totalIterations).toBe(1);
  });

  it('reports an LLM transport failure as llm_error, with the status in the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream is down', { status: 529 })),
    );
    const { page } = recordingPage();

    const result = await runAgent(page, request);

    expect(result.success).toBe(false);
    expect(result.failure).toBe('llm_error');
    expect(result.error).toContain('529');
    // The trace keeps the screenshot the failed call was made against.
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].screenshot).toBe('ZmFrZS1zY3JlZW5zaG90');
  });

  it('stops at the iteration ceiling and says that is what happened', async () => {
    stubModel([
      JSON.stringify({ reasoning: 'still looking', actions: [{ type: 'wait', duration: 1 }] }),
    ]);
    const { page } = recordingPage();

    const result = await runAgent(page, { ...request, maxIterations: 3 });

    expect(result.success).toBe(false);
    expect(result.failure).toBe('max_iterations');
    expect(result.totalIterations).toBe(3);
    expect(result.steps).toHaveLength(3);
  });

  it('clamps maxIterations to the documented ceiling of 30', async () => {
    const { fetchMock } = stubModel([JSON.stringify({ reasoning: 'still looking', actions: [] })]);
    const { page } = recordingPage();

    const result = await runAgent(page, { ...request, maxIterations: 500 });

    expect(result.totalIterations).toBe(30);
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });

  it('refuses to start without a key, and does not call out to do it', async () => {
    const { fetchMock } = stubModel([DONE]);
    const { page } = recordingPage();

    const result = await runAgent(page, { task: 'find the answer', provider: 'anthropic' });

    expect(result.failure).toBe('no_api_key');
    expect(result.totalIterations).toBe(0);
    expect(result.steps).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- The event seam --------------------------------------------------------

describe('runAgent events', () => {
  it('fires a screenshot before the model sees it, then the step it produced', async () => {
    stubModel([DONE]);
    const { page } = recordingPage();
    const order: string[] = [];
    const steps: AgentStep[] = [];
    // Captured, not asserted, inside the callback. `runAgent` swallows what a subscriber
    // throws, which includes a failed expectation, so an assertion in here can never fail.
    const screenshots: string[] = [];

    await runAgent(page, request, {
      onScreenshot: (iteration, screenshot) => {
        order.push(`screenshot:${iteration}`);
        screenshots.push(screenshot);
      },
      onStep: (step) => {
        order.push(`step:${step.iteration}`);
        steps.push(step);
      },
    });

    expect(order).toEqual(['screenshot:0', 'step:0']);
    expect(screenshots).toEqual(['ZmFrZS1zY3JlZW5zaG90']);
    expect(steps[0].actions).toEqual<AgentAction[]>([{ type: 'done', result: '42' }]);
  });

  it('stops at the next iteration once its signal is aborted', async () => {
    const { fetchMock } = stubModel([
      JSON.stringify({ reasoning: 'still looking', actions: [{ type: 'wait', duration: 1 }] }),
    ]);
    const { page } = recordingPage();
    const abort = new AbortController();

    const result = await runAgent(
      page,
      { ...request, maxIterations: 30 },
      {
        signal: abort.signal,
        onStep: () => abort.abort(),
      },
    );

    expect(result.failure).toBe('aborted');
    // One call made, then the abort landed. Without the check the loop would run all 30.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.totalIterations).toBe(1);
  });

  it('does not run the actions of a step whose model call outlived the caller', async () => {
    stubModel([
      JSON.stringify({ reasoning: 'click it', actions: [{ type: 'click', x: 10, y: 10 }] }),
    ]);
    const { page, calls } = recordingPage();
    const abort = new AbortController();

    await runAgent(page, request, { signal: abort.signal, onStep: () => abort.abort() });

    // Actions have side effects on a real page. A run nobody is watching must not click.
    expect(calls).toEqual([]);
  });

  it('does not abandon the run when a subscriber throws', async () => {
    stubModel([DONE]);
    const { page } = recordingPage();

    const result = await runAgent(page, request, {
      onStep: () => {
        throw new Error('the consumer disconnected');
      },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe('42');
  });
});

// --- The streaming route ---------------------------------------------------

/** A pool that hands out one fake session, and records whether it was given back. */
function fakePool(page: Page): { pool: BrowserPool; released: string[] } {
  const released: string[] = [];
  const pool = {
    createSession: async () => ({ id: 'sess-1', getPage: async () => page }),
    releaseSession: async (id: string) => {
      released.push(id);
      return true;
    },
  } as unknown as BrowserPool;
  return { pool, released };
}

async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const body = await res.text();
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)));
}

function streamRequest(body: unknown): Request {
  return new Request('http://localhost/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/agent/stream', () => {
  beforeEach(() => {
    stubModel([DONE]);
  });

  it('emits screenshot, step and done, and releases the session', async () => {
    const { page } = recordingPage();
    const { pool, released } = fakePool(page);

    const res = await agentRoutes(pool).request(streamRequest(request));
    const events = await readEvents(res);

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(events.map((e) => e.type)).toEqual(['screenshot', 'step', 'done']);
    expect(events[2]).toMatchObject({ type: 'done', result: '42', totalIterations: 1 });
    expect(released).toEqual(['sess-1']);
  });

  it('emits a terminal event when the run exhausts its iterations', async () => {
    // The old implementation closed the stream silently here, which a client cannot tell
    // apart from a dropped connection.
    vi.unstubAllGlobals();
    stubModel([JSON.stringify({ reasoning: 'still looking', actions: [] })]);
    const { page } = recordingPage();
    const { pool, released } = fakePool(page);

    const res = await agentRoutes(pool).request(streamRequest({ ...request, maxIterations: 2 }));
    const events = await readEvents(res);

    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'error', totalIterations: 2 });
    expect(String(last.error)).toMatch(/maximum iterations/i);
    expect(released).toEqual(['sess-1']);
  });

  it('reports the agent giving up as fail, not as a transport error', async () => {
    vi.unstubAllGlobals();
    stubModel([
      JSON.stringify({ reasoning: 'no', actions: [{ type: 'fail', reason: 'no login form' }] }),
    ]);
    const { page } = recordingPage();
    const { pool } = fakePool(page);

    const res = await agentRoutes(pool).request(streamRequest(request));
    const events = await readEvents(res);

    expect(events[events.length - 1]).toMatchObject({
      type: 'fail',
      reason: 'no login form',
      totalIterations: 1,
    });
  });

  it('releases the session when the page cannot be reached at all', async () => {
    const released: string[] = [];
    const pool = {
      createSession: async () => ({
        id: 'sess-1',
        getPage: async () => {
          throw new Error('browser crashed');
        },
      }),
      releaseSession: async (id: string) => {
        released.push(id);
        return true;
      },
    } as unknown as BrowserPool;

    const res = await agentRoutes(pool).request(streamRequest(request));
    const events = await readEvents(res);

    expect(events).toEqual([{ type: 'error', error: 'browser crashed' }]);
    expect(released).toEqual(['sess-1']);
  });

  it('reports a provider failure as an error carrying the iteration it happened on', async () => {
    vi.unstubAllGlobals();
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? anthropicReply(JSON.stringify({ reasoning: 'looking', actions: [] }))
          : new Response('upstream is down', { status: 529 });
      }),
    );
    const { page } = recordingPage();
    const { pool } = fakePool(page);

    const res = await agentRoutes(pool).request(streamRequest(request));
    const events = await readEvents(res);

    // The failure is on the second call, not the first, so the expected iteration is 1. A test
    // that fails on the first call expects 0, which is also what a hardcoded 0, a bare `i`, or
    // no arithmetic at all would produce.
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'error', iteration: 1 });
    expect(String(last.error)).toContain('529');
  });

  it('reports a missing key as an error, before any iteration happens', async () => {
    const { page } = recordingPage();
    const { pool } = fakePool(page);

    const res = await agentRoutes(pool).request(
      streamRequest({ task: 'find the answer', provider: 'anthropic' }),
    );
    const events = await readEvents(res);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(String(events[0].error)).toMatch(/No API key/i);
    // No `iteration` and no `totalIterations`: nothing ran. Both are asserted, because
    // dropping the `no_api_key` case falls through to the default branch, which would add
    // `totalIterations: 0` while leaving `iteration` undefined.
    expect(events[0].iteration).toBeUndefined();
    expect(events[0].totalIterations).toBeUndefined();
  });

  it('stops the run when the client hangs up mid-stream', async () => {
    // The whole reason the loop takes a signal. A vision run is up to thirty model calls, and
    // a streaming client disconnecting is the ordinary case, not an edge one: a closed tab, a
    // Ctrl-C, a proxy timeout. Before the signal existed, `emit` threw into the subscriber
    // guard, which swallowed it, and the run continued to the ceiling for nobody.
    vi.unstubAllGlobals();
    const { fetchMock } = stubModel([
      JSON.stringify({ reasoning: 'still looking', actions: [{ type: 'wait', duration: 1 }] }),
    ]);
    const { page } = recordingPage();
    const { pool, released } = fakePool(page);

    const res = await agentRoutes(pool).request(streamRequest({ ...request, maxIterations: 30 }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    // Waiting on the run actually ending, not on a fixed interval. A sleep plus a loose bound
    // makes the assertion a race against the machine, and the direction it loses in is the
    // dangerous one: a slower runner does fewer iterations per tick, so a broken loop would
    // creep back under the bound and the test would go green against the bug it exists to pin.
    // The session is released in the `finally`, so it fills in immediately when aborted and not
    // until all 30 iterations are done when not.
    await vi.waitFor(() => expect(released).toEqual(['sess-1']));

    // At most one: the cancel lands while the first model call is already in flight, and that
    // call is not cancelled (aborting the `fetch` would surface as an AbortError and get
    // labelled a provider outage). Zero when the cancel wins the race. Thirty when broken, and
    // the `waitFor` above is what makes that distinction safe on any machine, since a run that
    // is not aborted does not release its session until every iteration is done.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('rejects a request with no task before creating a session', async () => {
    const { page } = recordingPage();
    const { pool, released } = fakePool(page);

    const res = await agentRoutes(pool).request(streamRequest({ url: 'https://example.com' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'task is required' });
    expect(released).toEqual([]);
  });
});
