# Changelog

All notable changes to BrowseFleet are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-05-22)


### Features

* add AI agent layer - vision-based browser automation with Claude/GPT ([3acc03a](https://github.com/theRJMurray/browsefleet/commit/3acc03a7dba25b8c60806a74f8486ed4dceb5bbe))
* add operator-mode browser sessions ([#1](https://github.com/theRJMurray/browsefleet/issues/1)) ([78cf9e7](https://github.com/theRJMurray/browsefleet/commit/78cf9e77ae612a6cadb80588722aa2da76300727))
* add Stripe metered billing integration ([cdab111](https://github.com/theRJMurray/browsefleet/commit/cdab111017e70f6925077195972d562d1942dfcf))
* initial BrowseFleet - cloud browser API ([226635d](https://github.com/theRJMurray/browsefleet/commit/226635dbe2e0e60b6f006426e3e1a5d7d4871051))
* oss phase 1 foundation (license, governance, security, skill.md) ([#3](https://github.com/theRJMurray/browsefleet/issues/3)) ([90e4ba7](https://github.com/theRJMurray/browsefleet/commit/90e4ba7763ee7feb60b62fd4d3c6af3ef0caf49a))
* oss phase 2 docs and examples ([#4](https://github.com/theRJMurray/browsefleet/issues/4)) ([fcdb735](https://github.com/theRJMurray/browsefleet/commit/fcdb735703bcb2483fcefff83cf4a9021f83fe1c))
* oss phase 3 ci, releases, docker publish ([#5](https://github.com/theRJMurray/browsefleet/issues/5)) ([30d80f7](https://github.com/theRJMurray/browsefleet/commit/30d80f723dbb173cb866e925c948ffc45fe1bc50))


### Bug Fixes

* agent session ownership, timing-safe CDP auth, rate-limit cleanup ([aeef296](https://github.com/theRJMurray/browsefleet/commit/aeef2962f0a47ccddc5d3cb90caf1989fecdac35))

## [Unreleased]

### Added

- LICENSE (MIT), SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, GOVERNANCE.md.
- `skill.md` at the repo root. Lets any AI coding agent (Claude Code, Cursor, Aider) set up the project cold without further instruction.
- `.github/` issue templates, pull request template, FUNDING placeholder, CODEOWNERS.
- `.editorconfig`, `.nvmrc` pinning Node 22.
- `README.md`, the project front door. AI Agent banner, Mermaid architecture diagram, quick start, features, comparison, self-hosting table.
- `docs/` reference tree (9 pages): architecture, api, configuration, deployment, stealth, operator-mode, profiles, agent, comparison.
- `examples/` runnable subprojects (5): curl, node-quickstart, python-quickstart, operator-mode, cdp-direct.
- ESLint flat config + Prettier + Vitest test suite. 31 tests across `tests/health.test.ts`, `tests/auth.test.ts`, `tests/url-validator.test.ts`, `tests/extract.test.ts`.
- `src/logger.ts` and `src/app.ts` factory. `src/server.ts` is now a thin bootstrap that creates the pool, calls `createApp(pool)`, and starts the HTTP server. Lets tests import `createApp` and exercise the app via Hono's `app.request()` without binding a port.
- GitHub Actions workflows: `ci.yml` (lint + typecheck + test + build, Node 20 and 22 matrix), `docker.yml` (multi-arch buildx, GHCR publish on release), `release.yml` (release-please), `skill-smoke.yml` (re-runs the skill.md TL;DR block on every PR; fails if the file is stale), `pr-title.yml` (Conventional Commits enforcement).
- Dependabot for npm + Docker + GitHub Actions (`.github/dependabot.yml`).
- `prebuild` script that runs `rimraf dist` so removed sources do not linger in the build output.
- Dockerfile gains OCI image labels, `dumb-init` for signal handling, and prunes devDependencies before the final stage.
- `.gitattributes` pinning all text files to LF line endings. Keeps Prettier's `endOfLine: lf` check stable on Windows clones.

### Fixed

- `/health` now reads `version` from `package.json` at module load instead of a hard-coded string, so release-please version bumps are reflected without a separate edit.

### Changed

- `package.json` adds `license: MIT`, `repository`, `bugs`, `homepage` metadata. The `private: true` flag is removed.
- `package.json` adds `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test`, `test:watch`, `test:coverage` scripts.
- 5 source files migrated their `logger` import from `../server.js` to `../logger.js` to break a circular-import risk and let tests import the app without booting the server.

### Removed

- Stripe billing module (`src/billing/`, `src/routes/billing.ts`, `STRIPE_*` config, `stripe_*` columns in the `api_keys` table). BrowseFleet ships as a pure self-hosted OSS project at launch; the hosted-billing path is not part of the open-source artifact. If you need usage billing, run a thin proxy in front of BrowseFleet and meter at that layer.

### Security

- `npm audit fix` (non-breaking) dropped 7 vulnerabilities to 1 low (`@mozilla/readability` <0.6.0 requires a breaking-change bump; tracked as a follow-up).

## [0.1.0] - 2026-04-02

Initial private release. Not published to any registry.
