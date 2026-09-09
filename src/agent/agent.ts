import type { KeyInput, Page } from 'puppeteer-core';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { validateUrl } from '../utils/url-validator.js';
import { errorMessage } from '../utils/errors.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AgentRequest {
  task: string;
  url?: string;
  provider?: 'anthropic' | 'openai';
  model?: string;
  maxIterations?: number;
  apiKey?: string;
}

export interface AgentStep {
  iteration: number;
  reasoning: string;
  actions: AgentAction[];
  screenshot?: string;
}

export type AgentAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'press_key'; key: string }
  | { type: 'scroll'; deltaX?: number; deltaY?: number }
  | { type: 'wait'; duration: number }
  | { type: 'done'; result: string }
  | { type: 'fail'; reason: string };

/**
 * Why a run ended without success. A caller needs this to tell the agent deciding it cannot do
 * the task apart from the LLM call failing, which are the same `success: false` today and mean
 * completely different things to whoever is watching.
 */
export type AgentFailure = 'agent_fail' | 'llm_error' | 'no_api_key' | 'max_iterations';

export interface AgentResult {
  success: boolean;
  result?: string;
  error?: string;
  /** Set whenever `success` is false, absent otherwise. */
  failure?: AgentFailure;
  steps: AgentStep[];
  totalIterations: number;
}

/**
 * Progress callbacks, so a streaming transport can report the run as it happens instead of
 * reimplementing the loop around its own emitter. That reimplementation is exactly what
 * `POST /v1/agent/stream` used to be, and it drifted: it skipped the `res.ok` check, dropped
 * the humanized typing delay, turned an unparseable model response into a silent no-op instead
 * of a failure, and never told the client the run had hit its iteration ceiling.
 *
 * A callback that throws is logged and swallowed. A consumer that cannot keep up with its own
 * event stream is not a reason to abandon a browser session mid-task.
 */
export interface AgentEvents {
  /** Fired once per iteration, with the screenshot the model is about to be shown. */
  onScreenshot?(iteration: number, screenshot: string): void | Promise<void>;
  /** Fired after the model responds, with the step just recorded. */
  onStep?(step: AgentStep): void | Promise<void>;
}

// ─── LLM Providers ─────────────────────────────────────────────────────────

/** Only the fields read back are declared. Both providers return a great deal more. */
type AnthropicMessagesResponse = { content?: Array<{ text?: string }> };
type OpenAIChatResponse = { choices?: Array<{ message?: { content?: string } }> };

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  screenshotBase64: string,
): Promise<{ actions: AgentAction[]; reasoning: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 },
            },
            { type: 'text', text: userMessage },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as AnthropicMessagesResponse;
  const text = data.content?.[0]?.text ?? '';
  return parseAgentResponse(text);
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  screenshotBase64: string,
): Promise<{ actions: AgentAction[]; reasoning: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshotBase64}` },
            },
            { type: 'text', text: userMessage },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as OpenAIChatResponse;
  const text = data.choices?.[0]?.message?.content ?? '';
  return parseAgentResponse(text);
}

function parseAgentResponse(text: string): { actions: AgentAction[]; reasoning: string } {
  // Extract JSON from the response (may be wrapped in markdown code blocks)
  let json = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    json = codeBlockMatch[1];
  }

  // Try to find JSON object in the text
  const jsonMatch = json.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      actions: [{ type: 'fail', reason: 'Could not parse LLM response as JSON' }],
      reasoning: text,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      reasoning: parsed.reasoning ?? '',
    };
  } catch {
    return { actions: [{ type: 'fail', reason: 'Invalid JSON in LLM response' }], reasoning: text };
  }
}

// ─── Action Executor ───────────────────────────────────────────────────────

async function executeAction(page: Page, action: AgentAction): Promise<void> {
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
      await page.keyboard.type(action.text, { delay: 30 + Math.random() * 40 });
      break;
    case 'press_key':
      await page.keyboard.press(action.key as KeyInput);
      await new Promise((r) => setTimeout(r, 200));
      break;
    case 'scroll':
      await page.mouse.wheel({ deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 0 });
      await new Promise((r) => setTimeout(r, 500));
      break;
    case 'wait':
      await new Promise((r) => setTimeout(r, Math.min(action.duration, 10_000)));
      break;
    case 'done':
    case 'fail':
      break;
  }
}

// ─── Agent Loop ────────────────────────────────────────────────────────────

export async function runAgent(
  page: Page,
  request: AgentRequest,
  events: AgentEvents = {},
): Promise<AgentResult> {
  const provider = request.provider ?? 'anthropic';
  const model = request.model ?? (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
  const maxIterations = Math.min(request.maxIterations ?? 15, 30);
  const llmApiKey =
    request.apiKey ?? (provider === 'anthropic' ? config.ANTHROPIC_API_KEY : config.OPENAI_API_KEY);

  if (!llmApiKey) {
    return {
      success: false,
      failure: 'no_api_key',
      error: `No API key configured for ${provider}. Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} or pass apiKey in request.`,
      steps: [],
      totalIterations: 0,
    };
  }

  // A subscriber's failure is the subscriber's problem. The run continues.
  const notify = async (fire: () => void | Promise<void>): Promise<void> => {
    try {
      await fire();
    } catch (err) {
      logger.warn({ error: errorMessage(err) }, 'Agent event subscriber threw');
    }
  };

  // Navigate to initial URL if provided
  if (request.url) {
    await validateUrl(request.url);
    await page.goto(request.url, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1000));
  }

  const steps: AgentStep[] = [];
  const callLLM = provider === 'anthropic' ? callAnthropic : callOpenAI;

  for (let i = 0; i < maxIterations; i++) {
    // Take screenshot
    const screenshotBuffer = (await page.screenshot({ encoding: 'base64', type: 'png' })) as string;
    if (events.onScreenshot) await notify(() => events.onScreenshot!(i, screenshotBuffer));

    // Build message
    const userMessage = buildUserMessage(request.task, i, maxIterations);

    // Call LLM
    logger.info({ iteration: i, provider, model }, 'Agent calling LLM');

    let response: { actions: AgentAction[]; reasoning: string };
    try {
      response = await callLLM(llmApiKey, model, SYSTEM_PROMPT, userMessage, screenshotBuffer);
    } catch (err) {
      const message = errorMessage(err);
      logger.error({ error: message, iteration: i }, 'Agent LLM call failed');
      steps.push({
        iteration: i,
        reasoning: `LLM error: ${message}`,
        actions: [],
        screenshot: screenshotBuffer,
      });
      return {
        success: false,
        failure: 'llm_error',
        error: message,
        steps,
        totalIterations: i + 1,
      };
    }

    const step: AgentStep = {
      iteration: i,
      reasoning: response.reasoning,
      actions: response.actions,
      screenshot: screenshotBuffer,
    };
    steps.push(step);
    if (events.onStep) await notify(() => events.onStep!(step));

    logger.info(
      { iteration: i, reasoning: response.reasoning, actionCount: response.actions.length },
      'Agent step',
    );

    // Check for terminal actions
    for (const action of response.actions) {
      if (action.type === 'done') {
        return { success: true, result: action.result, steps, totalIterations: i + 1 };
      }
      if (action.type === 'fail') {
        return {
          success: false,
          failure: 'agent_fail',
          error: action.reason,
          steps,
          totalIterations: i + 1,
        };
      }
    }

    // Execute non-terminal actions
    for (const action of response.actions) {
      try {
        await executeAction(page, action);
      } catch (err) {
        logger.warn({ action: action.type, error: errorMessage(err) }, 'Agent action failed');
      }
    }

    // Let the page settle before the next screenshot.
    if (config.AGENT_STEP_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, config.AGENT_STEP_DELAY_MS));
    }
  }

  return {
    success: false,
    failure: 'max_iterations',
    error: `Agent reached maximum iterations (${maxIterations}) without completing the task`,
    steps,
    totalIterations: maxIterations,
  };
}
