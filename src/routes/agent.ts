import { Hono } from 'hono';
import type { BrowserPool } from '../pool/browser-pool.js';
import { runAgent } from '../agent/agent.js';
import type { AgentRequest } from '../agent/agent.js';
import { getOwnedSession } from '../utils/session-auth.js';
import { validateUrl } from '../utils/url-validator.js';

export function agentRoutes(pool: BrowserPool): Hono {
  const app = new Hono();

  // Autonomous agent — creates a session, runs the task, releases the session
  // POST /v1/agent
  app.post('/', async (c) => {
    const body = await c.req.json<AgentRequest>().catch(() => null);
    if (!body?.task) return c.json({ error: 'task is required' }, 400);

    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = await pool.createSession(
        {
          stealth: 'full',
          viewport: { width: 1280, height: 900 },
        },
        apiKey,
      );
    } catch (err: any) {
      return c.json({ error: `Failed to create session: ${err.message}` }, 500);
    }

    try {
      const page = await session.getPage();
      const result = await runAgent(page, body);

      // Strip screenshots from response to reduce payload (keep only final)
      const lightSteps = result.steps.map((s, i) => ({
        iteration: s.iteration,
        reasoning: s.reasoning,
        actions: s.actions,
        screenshot: i === result.steps.length - 1 ? s.screenshot : undefined,
      }));

      return c.json({
        ...result,
        steps: lightSteps,
        sessionId: session.id,
      });
    } finally {
      await pool.releaseSession(session.id);
    }
  });

  // Agent on existing session — uses an already-created session
  // POST /v1/sessions/:id/agent
  app.post('/:id/agent', async (c) => {
    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = getOwnedSession(pool, c.req.param('id'), apiKey);
    } catch (e: any) {
      return c.json({ error: e.message }, e.status ?? 404);
    }

    const body = await c.req.json<AgentRequest>().catch(() => null);
    if (!body?.task) return c.json({ error: 'task is required' }, 400);

    const page = await session.getPage();
    const result = await runAgent(page, body);

    // Strip intermediate screenshots
    const lightSteps = result.steps.map((s, i) => ({
      iteration: s.iteration,
      reasoning: s.reasoning,
      actions: s.actions,
      screenshot: i === result.steps.length - 1 ? s.screenshot : undefined,
    }));

    return c.json({ ...result, steps: lightSteps });
  });

  // TODO: refactor to reuse runAgent() with a step callback instead of duplicating the loop
  // Agent streaming — SSE stream of agent steps as they happen
  // POST /v1/agent/stream
  app.post('/stream', async (c) => {
    const body = await c.req.json<AgentRequest>().catch(() => null);
    if (!body?.task) return c.json({ error: 'task is required' }, 400);

    const apiKey = c.req.header('x-api-key');
    let session;
    try {
      session = await pool.createSession(
        {
          stealth: 'full',
          viewport: { width: 1280, height: 900 },
        },
        apiKey,
      );
    } catch (err: any) {
      return c.json({ error: `Failed to create session: ${err.message}` }, 500);
    }

    const sessionId = session.id;
    const poolRef = pool;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const safeClose = () => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        };
        const emit = (data: any) => {
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const page = await session!.getPage();

          // Navigate if URL provided
          if (body!.url) {
            await validateUrl(body!.url);
            await page.goto(body!.url, { waitUntil: 'networkidle2', timeout: 30_000 });
            await new Promise((r) => setTimeout(r, 1000));
          }

          const provider = body!.provider ?? 'anthropic';
          const model =
            body!.model ?? (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
          const maxIterations = Math.min(body!.maxIterations ?? 15, 30);

          const { config } = await import('../config.js');
          const llmApiKey =
            body!.apiKey ??
            (provider === 'anthropic' ? config.ANTHROPIC_API_KEY : config.OPENAI_API_KEY);

          if (!llmApiKey) {
            emit({ type: 'error', error: `No API key for ${provider}` });
            safeClose();
            return;
          }

          const { SYSTEM_PROMPT, buildUserMessage } = await import('../agent/prompt.js');

          for (let i = 0; i < maxIterations; i++) {
            const screenshotBuffer = (await page.screenshot({
              encoding: 'base64',
              type: 'png',
            })) as string;
            const userMessage = buildUserMessage(body!.task, i, maxIterations);

            emit({ type: 'screenshot', iteration: i, screenshot: screenshotBuffer });

            // Call LLM
            let responseText = '';
            try {
              if (provider === 'anthropic') {
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': llmApiKey,
                    'anthropic-version': '2023-06-01',
                  },
                  body: JSON.stringify({
                    model,
                    max_tokens: 1024,
                    system: SYSTEM_PROMPT,
                    messages: [
                      {
                        role: 'user',
                        content: [
                          {
                            type: 'image',
                            source: {
                              type: 'base64',
                              media_type: 'image/png',
                              data: screenshotBuffer,
                            },
                          },
                          { type: 'text', text: userMessage },
                        ],
                      },
                    ],
                  }),
                });
                const data = (await res.json()) as any;
                responseText = data.content?.[0]?.text ?? '';
              } else {
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${llmApiKey}`,
                  },
                  body: JSON.stringify({
                    model,
                    max_tokens: 1024,
                    messages: [
                      { role: 'system', content: SYSTEM_PROMPT },
                      {
                        role: 'user',
                        content: [
                          {
                            type: 'image_url',
                            image_url: { url: `data:image/png;base64,${screenshotBuffer}` },
                          },
                          { type: 'text', text: userMessage },
                        ],
                      },
                    ],
                  }),
                });
                const data = (await res.json()) as any;
                responseText = data.choices?.[0]?.message?.content ?? '';
              }
            } catch (err: any) {
              emit({ type: 'error', iteration: i, error: err.message });
              break;
            }

            // Parse response
            let json = responseText;
            const codeMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (codeMatch) json = codeMatch[1];
            const jsonMatch = json.match(/\{[\s\S]*\}/);

            let actions: any[] = [];
            let reasoning = '';
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                actions = parsed.actions ?? [];
                reasoning = parsed.reasoning ?? '';
              } catch {
                /* empty */
              }
            }

            emit({ type: 'step', iteration: i, reasoning, actions });

            // Check terminal
            let done = false;
            for (const action of actions) {
              if (action.type === 'done') {
                emit({ type: 'done', result: action.result, totalIterations: i + 1 });
                done = true;
                break;
              }
              if (action.type === 'fail') {
                emit({ type: 'fail', reason: action.reason, totalIterations: i + 1 });
                done = true;
                break;
              }
            }
            if (done) break;

            // Execute actions
            for (const action of actions) {
              try {
                switch (action.type) {
                  case 'navigate':
                    await validateUrl(action.url);
                    await page.goto(action.url, { waitUntil: 'networkidle2', timeout: 30_000 });
                    break;
                  case 'click':
                    await page.mouse.click(action.x, action.y);
                    await new Promise((r) => setTimeout(r, 300));
                    break;
                  case 'type':
                    await page.keyboard.type(action.text, { delay: 35 });
                    break;
                  case 'press_key':
                    await page.keyboard.press(action.key);
                    await new Promise((r) => setTimeout(r, 200));
                    break;
                  case 'scroll':
                    await page.mouse.wheel({
                      deltaX: action.deltaX ?? 0,
                      deltaY: action.deltaY ?? 0,
                    });
                    await new Promise((r) => setTimeout(r, 500));
                    break;
                  case 'wait':
                    await new Promise((r) => setTimeout(r, Math.min(action.duration, 10_000)));
                    break;
                }
              } catch {
                /* continue */
              }
            }

            await new Promise((r) => setTimeout(r, 500));
          }
        } finally {
          await poolRef.releaseSession(sessionId);
          safeClose();
        }
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
