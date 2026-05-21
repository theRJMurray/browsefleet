# Stealth

BrowseFleet ships with `puppeteer-extra-plugin-stealth` plus per-session randomization. This doc explains what is on by default, when to turn it down, and the ethics.

## What `STEALTH_DEFAULT=full` actually does

Three layers of behavior:

1. **The plugin.** `puppeteer-extra-plugin-stealth` applies a curated list of "evasions" against bot-detection fingerprints: `navigator.webdriver`, `chrome.runtime`, missing image dimensions, the WebGL vendor string, Notification permission, headless-ness leaks via the `User-Agent` and platform, and several dozen more. Source list: [berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth).
2. **Per-session randomization.** When the session is created (and no explicit `userAgent` or `viewport` are passed), BrowseFleet samples a viewport from a curated list of common real-world sizes (1920x1080, 1366x768, 1440x900, etc.) and a user agent from a curated list of recent Chrome strings on macOS, Windows, and Linux. Source: [`src/stealth/stealth.ts`](../src/stealth/stealth.ts).
3. **Process-level flags.** Chrome is spawned with a set of flags that suppress signals automation frameworks usually leave behind. `basic` and `full` both add `--disable-blink-features=AutomationControlled`. `full` additionally adds `--disable-features=IsolateOrigins,site-per-process` plus `--flag-switches-begin`/`--flag-switches-end` to keep the command-line shape closer to a real Chrome launch. Source: [`src/stealth/stealth.ts`](../src/stealth/stealth.ts).

The intent is to make a BrowseFleet session look indistinguishable from a real human's Chrome on a real desktop. It is not perfect; sufficiently motivated detection (TLS fingerprinting, mouse-movement entropy, behavioral analysis over time) can still flag you.

## When to turn it down

`STEALTH_DEFAULT` accepts three values. Each can be overridden per-session via the `stealth` field on `POST /v1/sessions` or on any one-shot endpoint.

| Setting          | Plugin | Per-session randomization | CPU overhead |
| ---------------- | ------ | ------------------------- | ------------ |
| `full` (default) | on     | on                        | highest      |
| `basic`          | on     | off                       | medium       |
| `none`           | off    | off                       | lowest       |

Use `none` when:

- You are scraping a site that is cooperative or that you operate. The CPU overhead of stealth is real (roughly 10 to 20% per request) and there is no benefit if the target is not actively detecting.
- You are running synthetic monitoring against your own infrastructure.
- You are debugging the BrowseFleet pipeline itself and want to rule out stealth as a variable.

Use `basic` when:

- You want the plugin's evasions but you are setting your own deterministic `userAgent` and `viewport` (e.g. for reproducible screenshot regressions).

Use `full` (the default) when in doubt.

## Per-session override

```bash
curl -X POST localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"stealth":"none"}'
```

```bash
curl -X POST localhost:3000/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://cooperative-api.example.com","stealth":"none"}'
```

## Verifying stealth is working

Screenshot a fingerprint-detection page with `stealth: "full"`:

```bash
curl -X POST localhost:3000/v1/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://bot.sannysoft.com","fullPage":true,"stealth":"full"}' \
  --output /tmp/sannysoft.png
```

Open `/tmp/sannysoft.png`. The page renders a grid of checks. Most cells should be green. A few yellows are normal; reds suggest a regression in the upstream stealth plugin or a Chrome version mismatch. The `/v1/screenshot` endpoint uses an ephemeral browser context internally, so no `POST /v1/sessions` is needed first.

## Ethics

Stealth is a dual-use feature. The good uses are obvious: automated testing, accessibility audits, archival, your own monitoring, agents acting on a user's behalf with consent. The bad uses are also obvious: spam, scraping in violation of clear terms, evading rate limits to abuse a service.

BrowseFleet's policy:

- **We do not accept PRs that improve stealth specifically against sites that have opted out of automation** (clear `robots.txt`, explicit ToS prohibitions, or active CAPTCHA + IP-block defense). This is in [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- **We will accept PRs that improve general-purpose stealth** (a new evasion for a fingerprint surface that breaks many legitimate use cases, not just one target).
- **We do not provide a curated list of "this works on $TARGET".** That is research the operator has to do themselves, with appropriate legal review.

If you are unsure whether your use is appropriate: it probably is not. Find a documented API or ask the site owner.

## See also

- [`src/stealth/stealth.ts`](../src/stealth/stealth.ts), the per-session randomization source.
- [Operator mode](./operator-mode.md), for flows that fail any amount of stealth on first attempt.
- [Profiles](./profiles.md), for keeping a logged-in fingerprint across sessions.
