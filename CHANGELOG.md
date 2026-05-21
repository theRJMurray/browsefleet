# Changelog

All notable changes to BrowseFleet are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
