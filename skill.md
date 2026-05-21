# Working in browsefleet with a coding agent

This file is read by AI coding agents that land in this repo (Claude Code, Cursor, Aider, etc.). It contains the exact setup, run, test, and contribution steps. Read it once at the start of any session; refer back to it on errors. The README points here from its AI Agent banner.

For human contributors, this file is also accurate and useful. There is no separate "human onboarding" doc.

## TL;DR for the impatient agent

```bash
git clone https://github.com/theRJMurray/browsefleet.git
cd browsefleet
cp .env.example .env
npm install
npm run dev
# in another terminal:
curl http://localhost:3000/health
```

Expected last line: `{"status":"ok","version":"0.1.0","activeSessions":0,"maxSessions":30,"uptime":<seconds>}`.

If any of those steps fail, jump to "Known failure modes" at the bottom of this file before trying anything else.

## Required tools and versions

| Tool                        | Minimum                 | Why                                                                                                       |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Node.js                     | 20.x (22.x recommended) | Runtime. Pinned in `.nvmrc`. ESM-only project, so 18.x and older will not work.                           |
| npm                         | 10.x                    | Bundled with Node 20+. The lock file is npm v3 format.                                                    |
| A system Chrome or Chromium | any recent              | Used by puppeteer-core. If not on PATH, set `CHROME_PATH` in `.env`.                                      |
| Docker                      | 24+ (optional)          | Only needed if you want to run the published container or build a local image.                            |
| C/C++ build toolchain       | any                     | `better-sqlite3` compiles native bindings on `npm install`. See "Known failure modes" for platform notes. |

The project intentionally has no other runtime dependencies. No Redis, no Postgres, no external job queue. All state is SQLite at `./data/browsefleet.db`.

## First-time setup

### 1. Clone and enter

```bash
git clone https://github.com/theRJMurray/browsefleet.git
cd browsefleet
```

### 2. Pick the right Node version

If you have `nvm` or `fnm` or `volta`:

```bash
nvm use   # reads .nvmrc, switches to Node 22
```

Verify:

```bash
node --version   # v22.x.x (or v20.x.x is also fine)
```

### 3. Copy the example env

```bash
cp .env.example .env
```

You do not need to fill anything in for a local dev run. The defaults work. The interesting variables are:

| Variable                               | Default             | When you would change it                                                                     |
| -------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `API_KEYS`                             | empty (no auth)     | Set a comma-separated list once you expose the server beyond localhost.                      |
| `MAX_CONCURRENT_SESSIONS`              | 30                  | Cap based on your host's RAM. Chrome with stealth wants ~2 GB per session.                   |
| `STEALTH_DEFAULT`                      | `full`              | Set to `none` or `basic` when scraping cooperative sites for less CPU overhead.              |
| `CHROME_PATH`                          | empty (auto-detect) | Set the absolute path to Chrome/Chromium if auto-detect fails.                               |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | empty               | Required only if you use the `/v1/agent` vision-based automation endpoint.                   |
| `CAPTCHA_API_KEY`                      | empty               | Required only if you use `/v1/sessions/:id/captcha/solve`. 2captcha is the current provider. |

The full list of env vars is in `.env.example`. There is no separate `config.json` or `config.yaml`.

### 4. Install dependencies

```bash
npm install
```

Expected: ~10 to 30 seconds. The slow part is `better-sqlite3` compiling its native binding. If it fails, see "Known failure modes" below.

### 5. Verify TypeScript compiles

```bash
npm run build
```

Expected: silent success. Output lands in `dist/`. No errors, no warnings.

## Running the project

### Dev mode (hot reload)

```bash
npm run dev
```

Starts `tsx watch` on `src/server.ts`. Binds `0.0.0.0:3000` (configurable via `PORT` and `HOST`). Watches the file tree and restarts on save.

### Production mode (from compiled output)

```bash
npm run build
npm start
```

`npm start` runs `node dist/server.js`. No watcher. Stop with `Ctrl+C` or send `SIGTERM`/`SIGINT`; the server drains all active browser sessions before exiting.

### Docker mode

```bash
npm run docker:build   # builds local image tagged `browsefleet`
npm run docker:run     # runs it on port 3000 with --shm-size=2g
```

`--shm-size=2g` is mandatory. Chrome crashes on the default 64 MB.

The official image once published lives at `ghcr.io/therjmurray/browsefleet:<tag>`. Publishing is set up in Phase 3 of the OSS arc; until then, build locally.

## Verifying it works (smoke test)

Run this against a server you just started with `npm run dev`. Each step should succeed before moving to the next.

```bash
# 1. Health check (should print JSON with status:ok)
curl -fsS http://localhost:3000/health

# 2. Create a session
SESSION=$(curl -fsS -X POST http://localhost:3000/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{}' | python -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "Session: $SESSION"

# 3. Scrape a public URL
curl -fsS -X POST http://localhost:3000/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' | head -c 200
echo ""

# 4. Take a screenshot to a file
curl -fsS -X POST http://localhost:3000/v1/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' --output /tmp/example.png
file /tmp/example.png   # should report: PNG image data

# 5. Release the session
curl -fsS -X POST "http://localhost:3000/v1/sessions/${SESSION}/release"
```

If all five succeed, the server is healthy. If step 2 fails with a Chrome error, see "Known failure modes". If steps 3 to 4 hang, the host probably needs more RAM (kill other Chrome processes).

## Project layout

```
browsefleet/
├── src/
│   ├── server.ts              # entrypoint, Hono app, route mounts, graceful shutdown
│   ├── config.ts              # zod-validated env-var schema
│   ├── auth.ts                # API key middleware (timing-safe)
│   ├── rate-limit.ts          # per-key + per-IP rate limiting
│   ├── types.ts               # shared TypeScript types
│   ├── pool/                  # BrowserPool, BrowserSession, Chrome lifecycle
│   ├── proxy/                 # CDP WebSocket proxy (transparent, bidirectional)
│   ├── routes/                # HTTP route handlers (sessions, scrape, screenshot, pdf, actions, captcha, profiles, files, agent)
│   ├── extract/               # HTML to markdown / readability content extraction
│   ├── stealth/               # puppeteer-extra-plugin-stealth config + per-session randomization
│   ├── db/                    # SQLite schema + helpers (better-sqlite3, WAL mode)
│   ├── agent/                 # vision-based AI agent backend (Claude or GPT)
│   └── utils/                 # small helpers
├── Dockerfile                 # multi-stage, Debian slim + Chromium
├── docker-compose.yml         # one-service compose with shm_size:2g
├── tsconfig.json
├── package.json
├── .env.example
├── LICENSE                    # MIT
├── README.md
├── skill.md                   # this file
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── GOVERNANCE.md
├── CHANGELOG.md
├── tests/                     # vitest suite (health, auth, url-validator, extract)
├── eslint.config.js
├── .prettierrc
├── vitest.config.ts
└── .github/                   # issue templates, PR template, CODEOWNERS, dependabot, CI workflows
```

`tests/` holds the vitest suite. Phase 3 of the OSS transformation arc shipped 4 test files (health, auth, url-validator, extract). The smoke test in the TL;DR block remains the end-to-end regression check.

## Common tasks

### Add a new HTTP endpoint

1. Create or edit a file in `src/routes/<area>.ts`. Existing files (`sessions.ts`, `scrape.ts`, `screenshot.ts`) are the pattern.
2. Mount it in `src/server.ts` with `app.route('/v1/<path>', <area>Routes(pool))`.
3. Validate the request body with `zod` at the top of the handler. See `routes/sessions.ts` for the convention.
4. Update `.env.example` if the endpoint introduces a new configuration variable.
5. Update `skill.md` (this file) if the smoke test should now exercise it.
6. Re-run `npm run build` and the smoke test.

### Add a new stealth tweak

1. Edit `src/stealth/stealth.ts`. The file owns `getStealthArgs`, `randomViewport`, `randomUserAgent`.
2. If the tweak is conditional, gate it on `config.STEALTH_DEFAULT === 'full'` or add a new `STEALTH_*` env var.
3. Test by hitting a fingerprint detection page (e.g. `https://bot.sannysoft.com`) via `/v1/screenshot`.

### Add a new session control mode

1. Edit the `ControlMode` union in `src/types.ts`.
2. Update the state machine in `src/pool/session.ts` (`setControlMode`).
3. Update `src/routes/sessions.ts` POST `/v1/sessions/:id/control` to accept the new mode.
4. Update the operator-mode docs (currently in `CLAUDE.md`; will move to `docs/operator-mode.md` in Phase 2).

### Bump puppeteer-core or puppeteer-extra

1. Update `package.json`. Bump both `puppeteer-core` and `puppeteer-extra` together.
2. Run `npm install`.
3. Check `puppeteer-extra-plugin-stealth` is still compatible. The stealth plugin uses runtime `require()` and breaks loudly when it isn't.
4. Run the full smoke test.

### Update the Docker base image

1. Edit `Dockerfile`. Bump `FROM node:<version>-bookworm-slim`.
2. Verify Chromium is still installed via apt (Debian Bookworm package name is `chromium`).
3. Run `npm run docker:build && npm run docker:run` and re-run the smoke test against the container.
4. Update `.nvmrc` to match if you bumped the Node major.

## Testing

```bash
npm test              # run the vitest suite once
npm run test:watch    # watch mode
npm run test:coverage # with v8 coverage report
```

The suite lives under `tests/` and uses `vitest`. New tests mirror the source layout: `tests/<area>.test.ts`. Mocks for outbound HTTP use Hono's in-process `app.request()` pattern; no `msw` or `nock` setup is needed.

For new behavior: add a test. For bug fixes: add a regression test. Tests run on every PR via `.github/workflows/ci.yml` (Node 20 and 22 matrix).

## Linting and formatting

```bash
npm run lint          # eslint flat config + typescript-eslint
npm run lint:fix      # autofix what can be autofixed
npm run format        # prettier --write across the tree
npm run format:check  # prettier --check (what CI runs)
npm run typecheck     # tsc --noEmit
```

ESLint uses the flat config at `eslint.config.js` with `typescript-eslint`'s recommended set. Prettier config is `.prettierrc`. Both run on every PR.

If you are adding a new global (browser API used inside `page.evaluate()`, Node 20+ API, etc.), add it to the `globals` list in `eslint.config.js`.

## Branching, commits, PRs

- **Base branch**: `master`. Branch off `master`, target `master`. (Will move to `main` in a future phase.)
- **Branch names**: kebab-case with a Conventional Commits prefix (`feat/profile-import`, `fix/cdp-proxy-close-race`).
- **Commits**: Conventional Commits, enforced by `.github/workflows/pr-title.yml` against the PR title. The PR title becomes the squashed commit message.
- **PRs**: squash-merged. Open against `master`. One logical change per PR.
- **CI**: `.github/workflows/ci.yml` runs lint + typecheck + tests + build on Node 20 and 22. `.github/workflows/docker.yml` builds a multi-arch image. `.github/workflows/skill-smoke.yml` re-runs this file's TL;DR block; if it fails, this file has drifted.
- **Releases**: handled by `release-please` (`.github/workflows/release.yml`). The bot opens a release PR; merging it cuts a tag and triggers the GHCR publish.
- **Review gate**: clean CI + a maintainer review. Senior-dev (or equivalent) review is encouraged for non-trivial PRs.

## Known failure modes

### `better-sqlite3` native build fails on `npm install`

Most common on first install. Diagnose by reading the full `npm install` output for the first error from `node-gyp`.

- **Linux**: install `build-essential` and `python3`. `sudo apt install build-essential python3`.
- **macOS**: install Xcode Command Line Tools. `xcode-select --install`.
- **Windows**: install the "Desktop development with C++" workload in Visual Studio Installer, or run `npm install -g windows-build-tools` (deprecated but still works).
- **Apple Silicon**: better-sqlite3 11+ ships prebuilt arm64 binaries. If it falls through to source build, ensure Xcode CLT is current.

If you switch Node major versions, you must rebuild: `rm -rf node_modules && npm install`.

### Chrome / Chromium not found

The server logs `Could not find browser binary` on startup.

- Check `which chromium` or `which google-chrome` (Linux/macOS). Set `CHROME_PATH` in `.env` to the absolute path.
- On Debian/Ubuntu: `sudo apt install chromium`.
- On macOS: `brew install --cask chromium`, or set `CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- On Windows: usually auto-detected. If not, set `CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe`.

The Docker image has Chromium baked in; this failure mode only applies outside Docker.

### Port 3000 already in use

`Error: listen EADDRINUSE: address already in use 0.0.0.0:3000`.

Find and kill the process:

```bash
# Linux / macOS
lsof -i :3000
kill <pid>

# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Or change the port: `PORT=3001 npm run dev`.

### `puppeteer-extra-plugin-stealth` warns about missing evasions on startup

Harmless. The plugin probes for evasions via runtime `require()` and warns when a sibling package version mismatches. The stealth defaults still apply. If you want a clean boot, bump `puppeteer-extra` and `puppeteer-extra-plugin-stealth` together (see "Common tasks").

### Sessions hang or screenshots time out under load

The Chrome process count exceeded what the host can sustain. Symptoms: `/v1/screenshot` returns 504, `MAX_CONCURRENT_SESSIONS` is much lower than the count of `chrome` processes in `ps`.

- Lower `MAX_CONCURRENT_SESSIONS` in `.env`.
- Confirm `--shm-size=2g` (Docker) or that `/dev/shm` has at least 2 GB (Linux host).
- Confirm RAM is not maxed. Stealth Chrome is roughly 200 to 500 MB per session in steady state, more under load.

### Operator-mode session returns `423 Locked` on `/actions`

Working as designed. The session is in `human` or `paused` control mode. Either flip the session back to `agent`:

```bash
curl -X POST http://localhost:3000/v1/sessions/<id>/control \
  -H 'Content-Type: application/json' \
  -d '{"controlMode":"agent"}'
```

Or use `/actions` with `controlMode:"agent"` set at session-creation time.

## Don't do

- **Do not edit `dist/`.** It is generated by `tsc`. Edit `src/` and rebuild.
- **Do not commit `.env`.** It is gitignored. Use `.env.example` for documenting variables.
- **Do not add a dependency with native bindings (`better-sqlite3`, `sharp`, `node-ffi`, etc.) without updating the `Dockerfile` to install the matching build tools.** The container build will fail otherwise.
- **Do not bump the Node major version in `.nvmrc` without also bumping the `Dockerfile` base image.** Mismatch will cause `better-sqlite3` ABI errors at runtime.
- **Do not reintroduce a hosted billing / Stripe path.** It was removed deliberately when the project went open-source. The rationale is in [`docs/projects/browsefleet-oss/decisions/ADR-0001-pure-oss-mit.md`](https://github.com/theRJMurray/overlord/blob/development/docs/projects/browsefleet-oss/decisions/ADR-0001-pure-oss-mit.md) in the upstream Overlord repo.
- **Do not add telemetry, phone-home, or auto-update behavior.** This project runs on operator infrastructure and stays silent.

## Where to ask

- Bugs: [open an Issue](https://github.com/theRJMurray/browsefleet/issues) using the bug report template.
- Feature ideas: use the feature request template.
- Questions / design discussion: [GitHub Discussions](https://github.com/theRJMurray/browsefleet/discussions).
- Security: do not open a public Issue. See [`SECURITY.md`](./SECURITY.md).

---

_Last updated as part of the OSS Phase 1 foundation work (2026-05-21). Linked from the README's AI Agent banner at the top of the file._
