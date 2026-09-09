import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import { runAgent } from '../agent/agent.js';
import type { AgentAction, AgentRequest, AgentResult, AgentStep } from '../agent/agent.js';
import { getOwnedSession } from '../utils/session-auth.js';
import { errorMessage, errorStatus } from '../utils/errors.js';

/** The session options every agent route creates its ephemeral session with. */
const AGENT_SESSION_OPTIONS = {
  stealth: 'full',
  viewport: { width: 1280, height: 900 },
} as const;

/**
 * A full run carries one base64 PNG per iteration, which is megabytes of JSON for a
 * fifteen-step task. Only the final screenshot is worth returning: it is the one that shows
 * the state the answer was read from.
 */
function stripIntermediateScreenshots(steps: readonly AgentStep[]): AgentStep[] {
  const last = steps.length - 1;
  return steps.map((step, i) => ({
    iteration: step.iteration,
    reasoning: step.reasoning,
    actions: step.actions,
    screenshot: i === last ? step.screenshot : undefined,
  }));
}

/** The SSE event shapes `POST /v1/agent/stream` emits. Documented in `docs/api.md`. */
type StreamEvent =
  | { type: 'screenshot'; iteration: number; screenshot: string }
  | { type: 'step'; iteration: number; reasoning: string; actions: AgentAction[] }
  | { type: 'done'; result?: string; totalIterations: number }
  | { type: 'fail'; reason?: string; totalIterations: number }
  | { type: 'error'; error: string; iteration?: number; totalIterations?: number };

/**
 * Map a finished run onto the one terminal event the stream owes its client.
 *
 * Every branch emits something. The previous implementation closed the stream silently when a
 * run exhausted its iteration ceiling, which a client cannot distinguish from a dropped
 * connection.
 */
function terminalEvent(result: AgentResult): StreamEvent {
  if (result.success) {
    return { type: 'done', result: result.result, totalIterations: result.totalIterations };
  }

  const error = result.error ?? 'Agent failed';
  switch (result.failure) {
    case 'agent_fail':
      return { type: 'fail', reason: error, totalIterations: result.totalIterations };
    case 'llm_error':
      return { type: 'error', error, iteration: result.totalIterations - 1 };
    case 'no_api_key':
    case 'aborted':
      return { type: 'error', error };
    default:
      return { type: 'error', error, totalIterations: result.totalIterations };
  }
}

export function agentRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  // Autonomous agent. Creates a session, runs the task, releases the session.
  // POST /v1/agent
  app.post('/', async (c) => {
    const body = await c.req.json<AgentRequest>().catch(() => null);
    if (!body?.task) return c.json({ error: 'task is required' }, 400);

    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = await pool.createSession(AGENT_SESSION_OPTIONS, apiKey);
    } catch (err) {
      return c.json({ error: `Failed to create session: ${errorMessage(err)}` }, 500);
    }

    try {
      const page = await session.getPage();
      const result = await runAgent(page, body);

      return c.json({
        ...result,
        steps: stripIntermediateScreenshots(result.steps),
        sessionId: session.id,
      });
    } finally {
      await pool.releaseSession(session.id);
    }
  });

  // Agent on an existing session, already created by the caller.
  // POST /v1/sessions/:id/agent
  app.post('/:id/agent', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, errorStatus(err) ?? 404);
    }

    const body = await c.req.json<AgentRequest>().catch(() => null);
    if (!body?.task) return c.json({ error: 'task is required' }, 400);

    const page = await session.getPage();
    const result = await runAgent(page, body);

    return c.json({ ...result, steps: stripIntermediateScreenshots(result.steps) });
  });

  // Agent streaming. SSE stream of agent steps as they happen.
  // POST /v1/agent/stream
  //
  // This is the same `runAgent` the two routes above call, subscribed to rather than
  // reimplemented. The loop it used to carry inline is gone.
  app.post('/stream', async (c) => {
    const body = await c.req.json<AgentRequest>().catch(() => null);
    if (!body?.task) return c.json({ error: 'task is required' }, 400);
    const request = body;

    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = await pool.createSession(AGENT_SESSION_OPTIONS, apiKey);
    } catch (err) {
      return c.json({ error: `Failed to create session: ${errorMessage(err)}` }, 500);
    }

    const activeSession = session;

    // A vision agent run costs a model call per iteration, up to thirty of them. If the client
    // hangs up, every one of those is spent on nobody, so a disconnect has to reach the loop.
    const abort = new AbortController();

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const safeClose = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the client's cancel. Nothing to do.
          }
        };
        const emit = (event: StreamEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // `enqueue` throws on every call after the stream is cancelled. The client is
            // gone, so stop producing and tell the run to stop too.
            closed = true;
            abort.abort();
          }
        };

        try {
          const page = await activeSession.getPage();
          const result = await runAgent(page, request, {
            signal: abort.signal,
            onScreenshot: (iteration, screenshot) =>
              emit({ type: 'screenshot', iteration, screenshot }),
            onStep: (step) =>
              emit({
                type: 'step',
                iteration: step.iteration,
                reasoning: step.reasoning,
                actions: step.actions,
              }),
          });
          emit(terminalEvent(result));
        } catch (err) {
          // Reaching here means the session died before or during the run. Say so, rather
          // than closing an empty stream and leaving the client to guess.
          emit({ type: 'error', error: errorMessage(err) });
        } finally {
          await pool.releaseSession(activeSession.id);
          safeClose();
        }
      },
      // Fired when the response socket closes. That is the ordinary way a streaming client
      // ends a run: a closed browser tab, a Ctrl-C on a curl, a proxy timeout.
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  return app;
}
