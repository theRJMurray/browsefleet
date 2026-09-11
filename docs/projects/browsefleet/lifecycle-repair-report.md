---
title: BrowseFleet lifecycle repair validation report
created: 2026-09-10
status: independent-review-clean
branch: codex/browsefleet-lifecycle-repair
base: 10740d019d2e38b520b1c505c044d50188534c45
reviewer_task: 01a08df3-f3c3-7011-8d8e-3091ddb3a53a
---

# Changes

Implements the bounded lifecycle lane from findings 1, 4 and 6 of the jobhunt review. The phase spec is `specs/phases/phase-1.md`.

- Cleanup shares one promise independently of status, preserves expired versus released status, cancels the expiry timer, disposes file storage and closes the browser. Concurrent pool releases retain accounting until close succeeds. Rejected close clears the cached cleanup promise for retry; the session remains owned. Failed setup whose close also rejects retains an orphan browser, ID and capacity until release or shutdown succeeds.
- Caller IDs are validated before launch/profile filesystem work: 1–128 ASCII letters, digits, underscores or hyphens, starting with a letter or digit. HTTP creation returns 400 for malformed IDs and 409 for duplicates.
- Files use independently generated private directories beneath the platform temporary directory. Reads, writes and deletion verify containment and reject directory links. File names reject separators, traversal, control characters and Windows alternate-stream syntax. Released storage cannot be recreated by an upload awaiting multipart parsing.
- IDs and capacity are reserved before the first await, retained during failure cleanup, and freed for retries. Setup exceptions close the launched browser. Expiry during setup prevents registration.
- Utility browser creation shares an in-flight promise. Ephemeral operations have a separate ceiling equal to MAX_CONCURRENT_SESSIONS, including work awaiting launch/context setup. Context setup and callback failures close contexts. Rejected context close surfaces failure and retains the slot; shutdown closes the utility browser after all admitted work settles. Shutdown cleanup errors retain ownership and can be retried. Shutdown blocks admission and drains pending work before closing resources; late launches cannot register.

# Exact validation

Executed in the repair worktree on Node v25.9.0, using the existing ancestor node_modules without a dependency install or lockfile change.

| Command                                                                                                                                                                                                                                                                                | Result                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                                                                                                                                    | Passed                                                  |
| `npm run lint`                                                                                                                                                                                                                                                                         | Passed, zero warnings                                   |
| `npm test -- --no-cache`                                                                                                                                                                                                                                                               | 124 passed in 7 files                                   |
| `npm test -- --no-cache tests/lifecycle.test.ts tests/session-files.test.ts`                                                                                                                                                                                                           | 64 passed: 47 lifecycle, 17 storage                     |
| `npm run build`                                                                                                                                                                                                                                                                        | Passed; generated output stays in ignored worktree dist |
| `node ../../../node_modules/prettier/bin/prettier.cjs --check src/pool/browser-pool.ts src/pool/session.ts src/pool/session-files.ts src/routes/files.ts src/routes/sessions.ts tests/lifecycle.test.ts tests/session-files.test.ts docs/projects/browsefleet/specs/phases/phase-1.md` | Passed                                                  |
| `git diff --check`                                                                                                                                                                                                                                                                     | Passed                                                  |

The full suite comprises agent 20, lifecycle 47, session files 17, URL validator 25, auth 5, extraction 6, and health 4. Expected mocked provider failures appear in the agent test logs; no real provider calls occur in those tests.

## Regression sensitivity

Within this worktree only, temporarily substituted origin/master versions of browser-pool.ts and session.ts, then executed:

`node ../../../node_modules/vitest/vitest.mjs run --no-cache tests/lifecycle.test.ts -t "expires and closes Chrome|closes Chrome on"`

All seven selected tests failed on the intended close-count assertion: expected one close, observed zero. They cover expiry and failures in endpoint discovery, page lookup, user-agent setup, viewport setup, header injection and cookies. The repaired files were restored in a finally block and the complete repaired suite subsequently passed. Raw output is preserved in ignored `.codex/lifecycle-review/baseline-regressions.txt`. A console encoding error occurred while printing that raw output; it did not prevent restoration or saving the results.

## Limits

Browser/launch lifecycle tests use deterministic fake browsers and gated promises. File tests use real temporary files and directory links under the repair worktree and remove their own fixtures. No real Chrome smoke test, load test, fresh dependency install, or Node 20/22 matrix was run. Containment checks are application-level defenses, not an OS sandbox against a hostile local process racing filesystem operations. Shutdown drains admitted work; it does not impose a new deadline on arbitrary callbacks. Browser/context close errors are surfaced and retain ownership for explicit release or shutdown retry.

# Diff and provenance

Final report-inclusive diff: 9 files, 1124 insertions and 171 deletions. Compare this branch with origin/master using `git diff --stat origin/master...HEAD` after the local commit. Changed code is limited to browser-pool.ts, session.ts, new session-files.ts, files.ts and the session-creation error mapping in sessions.ts. Tests and this phase documentation complete the lane.

Remote master was verified using `git ls-remote origin refs/heads/master` at 10740d019d2e38b520b1c505c044d50188534c45 before creating the worktree. Original local master remains clean at 1b8ccb171a4b118118f805c909da5764e57cec29, exactly two commits ahead. Neither unpublished CLI commit was imported, changed or published. Agent control, CDP auth, profiles, SSRF and dependencies were not changed.

# Review gate

Linnaeus round 1 found two P2 defects: swallowed browser-close and context-close rejections freed capacity despite live resources. Both were corrected, with six additional close-rejection/ownership/shutdown regressions. Round 2 independent re-review is CLEAN. Linnaeus independently re-ran a read-only in-memory harness confirming retained ID/capacity on session-close failure, orphan ownership across failed shutdown and retry, and the actual limit of one live context across four additional rejected requests plus utility-close/shutdown retry. All passed; no additional defect found. The reviewer did not run the filesystem-writing suite or real Chrome. Implementer final gates passed all 124 tests, typecheck, lint, build, formatting and whitespace checks. A redundant CLI senior-dev review was stopped after Linnaeus was assigned, with no findings produced. Main is delegated to land only after clean independent review. This lane has performed no push or merge. All authored files remain inside its own worktree; external Bridge/project-registry mutations are outside the explicit write boundary.
