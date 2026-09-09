# ADR-0001: Pure OSS, MIT-licensed, no hosted SaaS at launch

- **Status:** accepted
- **Date:** 2026-05-21

## Context

BrowseFleet was originally built as a hosted browser API. Four repositories already existed and
were feature-complete and security-hardened: the API server, the Node SDK, the Python SDK, and
the marketing site.

The decision recorded here is the one that changed that direction: open-source the project, and
do not run the hosted service.

## Decision

1. **License: MIT** for all four repositories.
2. **Commercial model: pure open source.** This project does not operate a hosted SaaS.
3. **Brand: BrowseFleet**, keeping the existing repository names.
4. **Scope: all four repositories** are open-sourced together.

## Rationale

### Why MIT, and not Apache 2.0, AGPL or BSL

MIT is the friction-free default, and it maximizes adoption for an SDK-fronted developer tool.

Apache 2.0 adds a patent grant that matters for enterprise-facing infrastructure of the
Kubernetes or Terraform kind. BrowseFleet's users are agent builders and individual developers,
and for them the patent clause is overhead they will not read.

AGPL would block the exact use case the project exists for, which is running it inside a larger
system that is not itself AGPL.

BSL solves a competitive problem against a hosted service. There is no hosted service here, so
it solves a problem this project does not have.

### Why pure open source rather than a hosted service

Running a hosted browser API is a real operations product: a compliance path, abuse mitigation,
captcha vendor relationships, on-call, billing edge cases, and a support burden. The repositories
are the higher-leverage artifact.

If a hosted version ever makes sense, MIT keeps that option open without relicensing.

### Why the marketing site is open source too

Resend, Vercel and Linear all publish their marketing sites publicly. Doing the same is a trust
signal for a project that asks operators to run it inside their own networks, and it lets
contributors fix the docs by pull request.

### Why all four repositories, and not some of them

The SDKs are not useful unless they are open source. Splitting the server from the SDKs, or
holding the marketing site back, creates a confusing two-tier project and invites speculation
about closed-source backdoors in a security-sensitive piece of infrastructure.

## Consequences

- The Stripe billing module is removed from the public API server. There is no hosted offering
  for it to bill.
- **Operator Mode stays.** It is a genuine differentiator and it was implemented in a
  project-agnostic way.
- This project does not capture revenue directly. That is the accepted trade for a tool anyone
  can read, run and embed.

## Alternatives rejected

- **Apache 2.0.** Marginal benefit for this user mix, and more text in every dependent project.
- **AGPL-3.0.** Kills the SDK use case and the "embed it in your agent stack" pitch outright.
- **BSL with a delayed MIT conversion.** Solves a hosted-service competitive problem this project
  is not having.
- **Open core, with paid features.** Governance complexity that is not justified at this stage.
