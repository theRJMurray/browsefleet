# Operator mode

Operator mode lets a session start in `human` control so a real person can log in, complete a flow that fails automation (CAPTCHA, OTP, vendor consoles with aggressive anti-bot), and then hand off to an agent. It is the difference between "this site is impossible to automate" and "this site needs a human for the first 60 seconds, then automation takes over".

## The control state machine

Every session has a `controlMode` field with three values:

| Mode     | Input actions allowed (`/v1/sessions/:id/actions`)                                              | Use when                                                          |
| -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `agent`  | yes                                                                                             | normal automation; the default for non-operator sessions          |
| `human`  | no (whole batch returns `423 Locked` if it includes anything other than `screenshot` or `wait`) | a real person is driving via the live viewer                      |
| `paused` | no (same gating as `human`)                                                                     | approvals, investigation, anything that should freeze the session |

Only `screenshot` and `wait` actions are allowed under `human` or `paused`. Everything else (including `move_mouse`) is treated as input and locks the batch. The `screenshot` action additionally returns `success: false` per-result when `sensitiveMode` is on.

State transitions are explicit. There is no auto-detection or auto-flip. The consumer of the API decides when to switch.

## Creating an operator-mode session

```bash
curl -X POST localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"operatorMode":true,"profileId":"<existing-profile-id>"}'
```

`operatorMode:true` starts the session with `controlMode: "human"`. The session is otherwise normal: it has a CDP URL, a live viewer URL, an event stream URL. Pair this with a `profileId` so the operator's login state persists for the next session.

## Live viewer and event stream

Two SSE endpoints let a UI render what the operator is doing. Both emit the same JSON payload shape; they differ in cadence:

- `GET /v1/sessions/:id/live` emits one snapshot every 500 ms (~2 fps) with the screenshot at JPEG quality 50. Intended for "live video" rendering. Closes automatically after 5 minutes; reconnect to continue.
- `GET /v1/sessions/:id/events` emits one snapshot per second as a named `snapshot` event with the screenshot at JPEG quality 45. Lower frame rate, intended for state-driven UIs.

The payload is `{ sessionId, status, controlMode, sensitiveMode, controlReason?, url, title, screenshot? }`. To render the screenshot, subscribe with `EventSource`, parse the JSON, and update an `<img>` element's `src` to `data:image/jpeg;base64,<screenshot>`. Both streams omit the `screenshot` field when `sensitiveMode` is on.

## Sensitive mode

For the password-typing window, you do not want screenshots in the live viewer or event stream:

```bash
curl -X POST localhost:3000/v1/sessions/<id>/control \
  -H 'Content-Type: application/json' \
  -d '{"sensitiveMode":true,"reason":"about to enter password"}'
```

While `sensitiveMode:true`:

- A standalone `screenshot` action returns `success: false` with an explanatory error.
- Other actions that normally include a follow-up screenshot (`click`, `type`, `scroll`, `navigate`) still execute but omit the screenshot from the result.
- `/live` and `/events` continue to emit snapshots, but `screenshot` is replaced by `screenshotSuppressed: true` so the consumer can show a placeholder.

Clear it the same way: `{"sensitiveMode":false}`.

## Handing off to an agent

After the operator finishes the manual portion:

```bash
curl -X POST localhost:3000/v1/sessions/<id>/control \
  -H 'Content-Type: application/json' \
  -d '{"controlMode":"agent","reason":"operator completed login"}'
```

The next `POST /v1/sessions/<id>/actions` will succeed. From here, the agent drives.

Common pattern: an operator-mode session creates a profile, the human logs in, the session is released, and subsequent agent-only sessions attach to the same profile. The login persists; the human is not needed again until the profile's cookies expire.

## A realistic flow

```
1. Operator UI calls POST /v1/profiles, gets profile_id.
2. UI calls POST /v1/sessions { profileId: profile_id, operatorMode: true }.
3. UI subscribes to GET /v1/sessions/:id/live and renders the JPEG stream.
4. Operator navigates to the vendor console, clicks Login, lands on the OTP page.
5. Operator clicks "Sensitive mode" in the UI, which POSTs { sensitiveMode: true }.
6. Operator types the OTP. The live viewer freezes.
7. Operator clears sensitive mode: { sensitiveMode: false }.
8. Operator clicks "Hand off to agent" in the UI: { controlMode: "agent" }.
9. UI hands the session id to an automation worker which calls POST /v1/sessions/:id/actions.
10. Worker finishes, calls POST /v1/sessions/:id/release.
11. Next time, automation calls POST /v1/sessions { profileId: profile_id } (no operatorMode, no human).
```

## When NOT to use operator mode

- Single-step scrapes that do not need login. Use the plain `/v1/scrape` endpoint.
- Flows where the agent can solve the whole problem unaided. Operator mode adds latency (human in the loop) and infrastructure complexity (UI for the operator).
- Anything you cannot trust a human operator with. Operator mode lets a person drive a browser on your infrastructure; treat the access list the same way you treat root SSH.

## Example

See [`examples/operator-mode/`](../examples/operator-mode/) for a runnable Node script that creates a profile, starts an operator session, prints the live viewer URL, waits for the operator to type a sentinel command, hands off to an agent for one automated task, and releases.

## See also

- [API reference: sessions](./api.md), `POST /v1/sessions` and `/control`.
- [Profiles](./profiles.md), for persisting the operator's login.
- [Agent](./agent.md), for the automation half of the flow.
