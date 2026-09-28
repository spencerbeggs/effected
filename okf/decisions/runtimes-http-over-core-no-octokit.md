---
type: Decision
title: runtimes reads GitHub over core HttpClient, never Octokit
description: "@effected/runtimes' two authenticated REST reads go through effect/http directly, with GitHub App auth left as a pluggable seam rather than a built-in."
status: draft
tags:
  - architecture
  - bundle
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: 6d253355e54940b9353f5135e8e6b86a64869ae150261a46dd667f2c9b8388ac
---

# runtimes reads GitHub over core HttpClient, never Octokit

## Context

`@effected/runtimes` needs two authenticated REST reads against GitHub's
API to resolve Bun and Deno release lists. A predecessor library met the
same need with `octokit` plus `@octokit/auth-app`, which together were
that library's entire runtime-dependency weight for funding exactly two
REST GETs.

## Decision

All network access in `@effected/runtimes` goes through `HttpClient` from
`effect/http`, with the consumer providing a fetch-backed layer
at the edge (`packages/runtimes/src/internal/http.ts`). That layer has no
requirements of its own, so providing it costs a consumer one import from
`effect`. There is no octokit dependency: the [dependency
policy](../conventions/dependency-policy.md)'s R1 rule permits a direct
`HttpClient` call for this shape and would not permit an Octokit
dependency for it.

GitHub App auth is a pluggable seam, not a built-in. JWT signing plus
installation-token exchange would put a runtime dependency in a
boundary-tier package, so `GitHubAuth` is a service whose shape is
"produce request headers," with anonymous, token and config-driven
layers shipped in-package; App auth is reachable by a consumer supplying
their own layer. Nothing in the consuming applications needs it today —
this is a recorded deviation from what the predecessor offered, not an
oversight to "fix" by adding a dependency.

`GitHubClient` is scoped honestly around this: the JSON-over-HTTP
machinery lives in `internal/http.ts`, and the unauthenticated Node
fetchers use it without auth headers, while `GitHubClient` itself keeps
only the authenticated REST list operations Bun and Deno need.
`GitHub.ts` owns the HTTP error family — one concept, a typed HTTP
transport failure — which the unauthenticated fetchers reuse rather than
minting a parallel error ladder.

## Alternatives rejected

**Port the predecessor's Octokit dependency as-is.** Rejected because two
REST GETs do not justify Octokit's dependency weight, and this package's
whole design goal is zero external runtime dependencies — see [HTTP over
core](#decision) and the package's boundary tier.

**Bundle GitHub App auth as a built-in layer.** Rejected because JWT
signing and installation-token exchange require a cryptography or JWT
dependency this package does not otherwise need, and no consuming
application uses App auth against this package today. Building it in
speculatively would cost every consumer the dependency weight for a
capability nobody has asked for.

## Consequences

This package and [`git`](../modules/git.md) independently reached the
same conclusion about core: core declares service abstractions it
implements for no runtime, so anything reaching for a subprocess,
terminal or CLI framework needs a platform package, and a library that
reaches for one becomes tier-3 for its own consumers. That is the same
reasoning behind keeping the `runtime-resolver` CLI in an external
repository and behind `git` owning a spawner seam rather than a
subprocess dependency. A consumer wanting GitHub App auth for `runtimes`
supplies their own `GitHubAuth` layer; the package's own layers stay
limited to anonymous, static-token and config-driven forms.
