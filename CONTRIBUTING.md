# Contributing to BrowseFleet

Thanks for taking the time. BrowseFleet is a small, fast-moving project and good PRs are merged quickly.

## TL;DR

1. Read [`skill.md`](./skill.md) for the exact setup, run, test, and contribution commands. It is written for both humans and AI coding agents; it is the single source of truth for how this repo works on your machine.
2. Fork, branch off `master`, make your change, run `npm run build` and the smoke test in `skill.md`, commit using [Conventional Commits](https://www.conventionalcommits.org/), open a PR.
3. A maintainer reviews. We aim for a first response within five business days. CI (Vitest, lint, build) lands in Phase 3 of the OSS transformation arc and will run automatically once configured.

## What makes a good PR

- **Small and focused.** One logical change. If you are touching more than ten files, consider splitting.
- **Tests when the suite exists.** A formal Vitest suite arrives in Phase 3. Until then, manual smoke tests count; once Vitest lands, new behavior gets a test and bug fixes get a regression test.
- **No drive-by refactors.** If you spot something gnarly, file an Issue. Mixing refactors into a feature PR makes review hard.
- **Honest about scope.** If your PR depends on follow-up work, say so in the body.
- **Updates `skill.md` when setup changes.** If your PR adds a new env var, a new build step, or a new runtime dependency, update `skill.md` in the same PR.

## Commit style

We follow Conventional Commits. The PR title is what lands in the squashed commit, so write it as a conventional commit:

| Prefix      | Use for                                                 |
| ----------- | ------------------------------------------------------- |
| `feat:`     | new user-visible feature                                |
| `fix:`      | bug fix                                                 |
| `perf:`     | performance improvement, no behavior change             |
| `refactor:` | code change that neither fixes a bug nor adds a feature |
| `docs:`     | documentation only                                      |
| `test:`     | test only                                               |
| `chore:`    | tooling, build, CI, dependencies                        |
| `ci:`       | CI configuration only                                   |

A `BREAKING CHANGE:` footer or a `!` in the subject (e.g. `feat!: ...`) triggers a major version bump on the next release.

## Branching

Branch directly off `master`. Name your branch with a short kebab-case description prefixed by the change type:

```
feat/profile-import
fix/cdp-proxy-close-race
docs/add-fly-io-deploy-recipe
```

PRs target `master`. There is no `develop` or `main` branch in this repo; the default branch is `master` (this will likely move to `main` in a future cleanup pass, but until then, please target `master`).

## Reviews

The maintainer (RJ Murray, `@theRJMurray`) is the default reviewer on every PR. Reviews focus on:

1. Does the change do what the PR title says, and nothing more?
2. Is there a test that would catch this regressing?
3. Does it match the project's existing patterns (file layout, naming, error handling)?
4. Does it survive an honest "what happens when this is exposed to the public internet" read?

A clean review pass plus green CI is the merge gate. We squash-merge by default.

## What we will not accept

- Adding telemetry or phone-home behavior. BrowseFleet runs on operator-owned infrastructure and stays silent.
- Reintroducing the billing / hosted-SaaS path that was removed during the OSS conversion. See [`docs/projects/browsefleet-oss/decisions/ADR-0001-pure-oss-mit.md`](https://github.com/theRJMurray/overlord/blob/development/docs/projects/browsefleet-oss/decisions/ADR-0001-pure-oss-mit.md) in the upstream Overlord repo for the rationale.
- Stealth or anti-detection improvements aimed specifically at evading bot detection on sites that have explicitly opted out via `robots.txt` or terms of service. We are not in the abuse-enablement business.

## Security issues

Do **not** file security issues as public GitHub Issues. See [`SECURITY.md`](./SECURITY.md) for the private disclosure process.

## Code of Conduct

By participating in this project you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). It is the standard Contributor Covenant 2.1.

## Licensing

By submitting a contribution, you agree that your contribution is licensed under the [MIT License](./LICENSE), the same license as the rest of the project. No CLA. No copyright assignment.
