---
title: BrowseFleet lifecycle repair phase 1
status: reviewed
base: 10740d019d2e38b520b1c505c044d50188534c45
created: 2026-09-10
---

# Phase 1: Bounded lifecycle repair

Repair review findings 1, 4, and 6. Preserve expired versus explicitly released status while sharing one cleanup operation. Reserve session IDs and capacity synchronously before launch, retain reservations until failed setup is cleaned, and drain pending creation on shutdown. Rejected browser closes retain capacity and ID ownership and permit retry; failed context closes retain ephemeral capacity until shutdown disposes their browser. Share utility launch, bound ephemeral work using the configured session limit, and close contexts after setup failures.

Caller IDs must be strings of 1–128 ASCII letters, digits, underscores or hyphens, starting with a letter or digit. Reject malformed IDs before launch or filesystem access. Store files in independently generated private temporary directories, check resolved containment and symlinks before access/removal, and prevent uploads from resurrecting released storage across awaits.

## Gates

- Regression tests exercise expiry, repeated/concurrent release, shutdown during launch, duplicate/capacity admission across awaits, launch and post-launch failures, utility initialization, and ephemeral context setup failure.
- File tests reject traversal/separators/malformed IDs, enforce containment, and exercise real temporary file upload/read/cleanup inside this worktree.
- Typecheck, lint, full tests and build pass; changed files pass formatting.
- Senior developer review followed by corrections and re-review, at most three rounds. Main independent review remains required before push or merge.

## Exclusions

Agent control, CDP authorization, profile ownership, SSRF, dependencies and the two unpublished local CLI commits remain outside this phase. All authored files and test artifacts stay in this worktree. No push or merge.
