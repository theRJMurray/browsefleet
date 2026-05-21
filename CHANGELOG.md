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

### Changed

- `package.json` adds `license: MIT`, `repository`, `bugs`, `homepage` metadata. The `private: true` flag is removed.

### Removed

- Stripe billing module (`src/billing/`, `src/routes/billing.ts`, `STRIPE_*` config, `stripe_*` columns in the `api_keys` table). BrowseFleet ships as a pure self-hosted OSS project at launch; the hosted-billing path is not part of the open-source artifact. If you need usage billing, run a thin proxy in front of BrowseFleet and meter at that layer.

## [0.1.0] - 2026-04-02

Initial private release. Not published to any registry.
