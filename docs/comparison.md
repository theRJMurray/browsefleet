# Comparison

How BrowseFleet compares to the other ways to run a cloud browser API. This is the honest version, including what each competitor does better.

## TL;DR

| | BrowseFleet | Steel.dev | Browserbase | Raw Playwright/Puppeteer |
|---|---|---|---|---|
| License | MIT | Apache 2.0 | proprietary | (the lib is OSS) |
| Self-host | yes (the default) | yes (open core) | no | yes (you build it) |
| Hosted SaaS | no | yes | yes | no |
| Stealth | yes (puppeteer-extra-plugin-stealth) | yes | yes | bring your own |
| Profile persistence | yes | yes | yes | bring your own |
| Human-in-the-loop control | yes (operator mode) | partial | no | bring your own |
| AI agent layer | yes (vision-based, pluggable model) | yes (separate product) | yes (Stagehand SDK) | bring your own |
| Official SDKs | Node, Python | Node, Python | Node, Python | Node, Python natively |
| CDP proxy passthrough | yes | yes | yes | direct |
| Price (hosted) | n/a (no hosted offering) | starts ~$99/mo, scales by browser-hours | starts ~$99/mo, scales by browser-hours | infrastructure cost only |
| Price (self-hosted) | infrastructure only | infrastructure only | n/a | infrastructure only |

## vs Steel.dev

[Steel.dev](https://steel.dev) is the closest competitor. Apache 2.0 licensed, open core, hosted SaaS available.

**Where Steel is better:**

- **Hosted offering.** If you do not want to run infrastructure, Steel sells you the hosted version and bills by browser-hour. BrowseFleet does not.
- **More mature operator dashboard.** Steel has a polished web UI for session management; BrowseFleet exposes SSE endpoints and leaves the UI to the consumer.
- **Larger published feature list.** Steel has been at this longer.

**Where BrowseFleet is better:**

- **MIT vs Apache 2.0.** Friction-free for SDK consumers (no NOTICE attribution requirement).
- **One process, one SQLite file, one Docker image.** Steel's self-host story has more moving parts. BrowseFleet runs on a $4 Hetzner box.
- **Honest about scope.** The agent layer ships in the same repo, not as a separate product or a paid tier.
- **No registration to read the code.** Steel's hosted is behind a signup.

**When to pick Steel:** you want hosted and you do not want to be in the infrastructure business. You are willing to pay a per-browser-hour price.

**When to pick BrowseFleet:** you are running it yourself anyway, or you want full source access including the billing/auth layers (BrowseFleet's are intentionally minimal; you bring your own).

## vs Browserbase

[Browserbase](https://browserbase.com) is the polished, well-funded hosted competitor. Proprietary, hosted only, slick UI.

**Where Browserbase is better:**

- **Production polish.** Their dashboard, session replay, and observability features are well past where BrowseFleet (or Steel) sit.
- **Stagehand.** Their AI-agent layer is a separate library (also OSS, MIT) with more vendor-tuning than BrowseFleet's built-in agent.
- **Multi-region.** They run it in multiple regions; you don't have to.
- **Compliance.** SOC2, etc.

**Where BrowseFleet is better:**

- **Source available.** You can audit, fork, fix, and ship a private branch.
- **No vendor risk.** Browserbase can change pricing, deprecate features, get acquired. BrowseFleet running on your infra is yours.
- **Cost predictability.** You pay for the VPS, not per browser-hour.

**When to pick Browserbase:** you are funded, you do not want to operate infrastructure, you want SOC2 today.

**When to pick BrowseFleet:** any of: budget-constrained, audit-required, fork-required, OSS preference, data-residency requirement that demands a specific host.

## vs raw Playwright or Puppeteer

The "just spin up Chrome yourself" path. Playwright and Puppeteer are the underlying libraries that BrowseFleet uses; you can absolutely use them directly.

**Where raw Playwright/Puppeteer is better:**

- **Latency.** No HTTP indirection. The agent talks to Chrome over CDP in-process.
- **Lower complexity for one-host setups.** If you are running your scraper on one box that also runs Chrome, BrowseFleet's REST API is overhead.
- **Maximum control.** You write the lifecycle, the stealth setup, the profile management.

**Where BrowseFleet is better:**

- **You don't write the lifecycle.** Pool management, session expiration, graceful shutdown, profile bookkeeping, CDP proxy, SSE viewers: these are real code you would otherwise write.
- **One BrowseFleet host serves many clients.** Whether your scraper, your agent, your CI, and your monitoring all need browsers: one BrowseFleet host fronts all of them.
- **Operator mode + stealth defaults.** Two non-trivial features that come for free.
- **Multi-language.** Playwright's Python and Node are first class; the moment you need both, BrowseFleet is the path of less resistance.

**When to pick raw libraries:** small project, one process, one language, no operator-mode requirement, willing to write infrastructure.

**When to pick BrowseFleet:** multiple consumers, multiple languages, want operator mode for free, want stealth tuned and randomized for free.

## What is NOT a fair comparison

- **Apify, ScrapingBee, ScraperAPI.** These are scraping-as-a-service: they take a URL and return data. BrowseFleet exposes the browser, not the data. Different shape of product.
- **Selenium Grid.** Selenium is a different protocol (W3C WebDriver). BrowseFleet speaks CDP. Workloads sometimes overlap but the projects are not direct substitutes.
- **Headless Chrome the Node module.** That is the underlying library. You can call it directly; BrowseFleet is one of many ways to consume it.

## See also

- [Architecture](./architecture.md), what BrowseFleet actually is internally.
- [Deployment](./deployment.md), what self-hosting looks like.
- [`README.md`](../README.md), the project overview.
