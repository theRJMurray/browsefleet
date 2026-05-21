# Agent

`POST /v1/agent` and `POST /v1/sessions/:id/agent` run a vision-based AI agent inside the browser. You pass a natural-language task; the agent screenshots the page, reasons over the image with Claude or GPT, decides on a browser action (click, type, scroll, navigate), executes it, screenshots again, and loops until the task is done or `maxIterations` is hit.

This is a thin, honest wrapper over the model's vision capability and the Computer API actions. There is no proprietary planning layer, no internal RAG, no fine-tuning. The agent's quality is the model's quality.

## When this is the right tool

Use the agent when:

- The task is one a human could do by looking at the page (no API exists, the API is undocumented, the flow is multi-step and dynamic).
- You can describe the success criterion in one sentence ("extract the cheapest flight from YYZ to JFK", "click through to the pricing page and screenshot it").
- The cost (model tokens + browser time) is acceptable. A typical task is 5 to 15 iterations; each iteration is one screenshot + one model call. Pricing varies by model.

Do not use the agent when:

- The site has an API. Use the API.
- The task is deterministic (scrape this URL, screenshot that URL). Use `/v1/scrape` or `/v1/screenshot`.
- You need sub-second latency or guaranteed determinism.

## Calling it (ephemeral)

```bash
curl -X POST localhost:3000/v1/agent \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Find the price of the most expensive item on this page",
    "url": "https://example.com/products",
    "provider": "anthropic",
    "maxIterations": 10
  }'
```

The server creates a one-shot session, runs the agent against it, releases the session, and returns:

```json
{
  "success": true,
  "result": "The most expensive item is the Premium Bundle at $499.",
  "steps": [
    {
      "iteration": 1,
      "reasoning": "I see a product grid. Let me scroll to find the highest price.",
      "actions": [{ "type": "screenshot" }, { "type": "scroll", "deltaY": 500 }],
      "screenshot": "data:image/png;base64,..."
    },
    {
      "iteration": 2,
      "reasoning": "The Premium Bundle at $499 appears to be the highest.",
      "actions": [{ "type": "screenshot" }],
      "screenshot": "data:image/png;base64,..."
    }
  ],
  "totalIterations": 2
}
```

## Calling it (on an existing session)

When you already have a session (operator-mode handoff, mid-flow):

```bash
curl -X POST localhost:3000/v1/sessions/<id>/agent \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Fill in the address form with: 123 Main St, Toronto, M5V 3K9",
    "maxIterations": 5
  }'
```

The agent operates on the existing page. The session must be in `controlMode: "agent"` (the default for non-operator sessions). If it is in `human` or `paused`, the agent's actions will hit `423 Locked` and the call returns an error.

## Providers and models

| `provider`            | Default `model` (server)                                                               | Env var required    |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------- |
| `anthropic` (default) | a current Claude Sonnet snapshot, set in [`src/agent/agent.ts`](../src/agent/agent.ts) | `ANTHROPIC_API_KEY` |
| `openai`              | `gpt-4o`                                                                               | `OPENAI_API_KEY`    |

The Anthropic default model id moves forward as new Sonnet versions ship; the source file is the contract. You can pass your own model id in the `model` field. The agent does not validate the id; if the upstream API rejects it, the error bubbles up.

You can also pass a per-request API key in the `apiKey` field of the body to override the env var. Useful for multi-tenant setups where each caller funds their own model usage.

## Cost and safety

- **Cost.** Each iteration sends one full-page screenshot to the model. Screenshots are large (~100 KB to ~1 MB depending on viewport). At 10 iterations per task you are looking at roughly 5 to 10 MB of image input, plus the model's text output. Budget accordingly.
- **Loops.** `maxIterations` caps the number of model rounds. The server default is 15 and the hard ceiling is 30. Bring it down for predictable cost.
- **Hallucination.** The agent will sometimes claim a task is complete when it is not, or claim a fact that is wrong. Use the `success` flag and `result` text as a hint, not as ground truth. For high-stakes flows, verify with a second pass or a deterministic check.
- **Cost runaway protection.** If a task hits `maxIterations` without finishing, the agent returns `{ success: false, error: "Agent reached maximum iterations (<N>) without completing the task" }`. The browser session is still released.

## Available actions

The agent emits actions from the Computer API ([see api.md](./api.md#computer-api-per-session-actions)). The full set:

`screenshot`, `click(x, y)`, `type(text)`, `press_key(key)`, `scroll(deltaY)`, `move_mouse(x, y)`, `wait(duration_ms)`, `navigate(url)`.

The agent picks one or more actions per iteration. There is no plan-and-then-execute layer; the agent decides reactively from the current screenshot.

## See also

- [API reference: agent](./api.md), endpoint surface.
- [Operator mode](./operator-mode.md), to hand off to the agent from a human session.
- [`src/agent/agent.ts`](../src/agent/agent.ts), the agent loop source.
