# Governance

BrowseFleet is maintained by RJ Murray ([@theRJMurray](https://github.com/theRJMurray)) under a Benevolent Dictator For Life (BDFL) model. Contributions from the community are welcome via Pull Request; the BDFL has final say on direction, scope, and merges.

This is honest about the project's stage. As the contributor base grows, governance may evolve into a maintainer team and then a formal steering committee. We do not pretend to be a community-governed project on day one; pretending would be a worse signal than the truth.

## How decisions are made

- **Small changes** (bug fixes, docs, minor features): a clean PR with green CI and one maintainer approval merges. Default reviewer is the BDFL.
- **Significant changes** (new endpoints, breaking API changes, dependency swaps, removal of a feature): open an Issue describing the proposal first. Wait for explicit BDFL acknowledgement before investing significant implementation time.
- **Project direction** (license, hosted offering, brand, major architectural pivots): documented as Architecture Decision Records in [`docs/projects/browsefleet-oss/decisions/`](https://github.com/theRJMurray/overlord/tree/development/docs/projects/browsefleet-oss/decisions) in the upstream Overlord repo. The first one, ADR-0001, locks in MIT + pure-OSS + the four-repo scope.

## What a contributor can rely on

- Your PR will get a first response within five business days. If it does not, ping the BDFL on the PR thread.
- A reasoned merge or rejection. If your PR is rejected, the BDFL will say why; we do not silently close PRs.
- The license will not change without a public RFC. If MIT ever changes, every contributor whose code is affected gets named and asked.
- Your name in the contributor list. We do not strip attribution.

## What a contributor cannot rely on

- A response over the weekend. The BDFL is one human.
- Acceptance of every PR. Scope creep, abuse-enablement, and reintroduction of the removed hosted/billing path will be declined regardless of code quality.
- A specific release date. Releases happen when there is enough merged work to justify one.

## Becoming a maintainer

We will add maintainers as the project warrants it. The threshold is roughly:

- Five or more merged PRs across two or more areas (server, SDKs, marketing site).
- Demonstrated good judgment in PR reviews of other contributors' work.
- Willingness to take on issue triage rotation.

There is no formal application; the BDFL will reach out when these conditions are met.

## Forks

BrowseFleet is MIT-licensed. You are explicitly invited to fork. If the project's direction stops serving your needs, a fork is a feature, not a betrayal. Please change the name of your fork so users understand they are downloading a different artifact.
