---
type: Decision
title: "@effect/platform-node is a required peer in exactly one package"
description: github-actions is the only kit package with a required @effect/platform-node peer, because a GitHub Action always compiles into one Node process on a GitHub-provided runner; the licence is scoped to that overlay and does not generalize to any other package.
status: stable
tags:
  - architecture
  - bundle
sources:
  - id: github-actions-package
    resource: ../../packages/github-actions/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 4025479c90c2fda3
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 6fede24520fde764
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# @effect/platform-node is a required peer in exactly one package

## Context

Most kit packages stay platform-neutral: they declare their IO through
core Effect contracts (`FileSystem`, `ChildProcessSpawner`, `HttpClient`)
and let the consumer supply a platform layer. `@effected/github-actions`
is different — it is the runtime for a GitHub Action, and a GitHub Action
always runs as a Node process on a GitHub-hosted or self-hosted runner.
The question was whether that one package should still carry the
platform abstraction the rest of the kit holds, or take the concrete
dependency directly.

## Decision

`@effect/platform-node` is a required peer dependency in exactly one
package: `@effected/github-actions`.[^github-actions-package] No other
package in the workspace lists it as a peer. The reasoning is that a
GitHub Action has exactly one platform — there is no second runtime an
action could plausibly target — so abstracting over a platform choice
that never varies would tax every consumer of this one package for a
choice nobody makes. The licence that follows is scoped narrowly to that
one overlay: only `github-actions` may import `node:` directly and
compose `NodeServices.layer`, and that licence does not generalize to the
next Node-shaped package the kit might add. A future package facing the
same "always exactly one platform" argument earns its own explicit
decision; it does not inherit this one by resemblance.

## Alternatives rejected

- **Keep `github-actions` platform-neutral, like every other package**,
  and let its consumer supply `@effect/platform-node`. Rejected because
  every real consumer of the package is, by definition, a GitHub Action
  running on Node — there is no consumer for which the platform is
  actually a variable, so the abstraction would be pure overhead with no
  corresponding flexibility.
- **Generalize the peer licence to any package with a similarly narrow
  runtime target.** Rejected — the licence is granted per package on its
  own argument, not as a standing exemption category. Widening it
  defensively would erode the platform-neutral posture that lets every
  other package stay usable from Node, Bun or Deno alike.

## Consequences

`@effected/github-actions` is the one package licensed to import `node:`
directly and to compose `NodeServices.layer` in its default runtime; every
other package's consumer supplies its own platform layer. Any new
package that wants the same licence needs its own decision record making
the same "exactly one platform, always" argument — this decision is not
precedent by default.

[^github-actions-package]: `packages/github-actions/package.json:52-55` —
    `"peerDependencies": { "@effect/platform-node": "catalog:effect:peers",
    "effect": "catalog:effect:peers" }`, the only `peerDependencies` block
    in the workspace naming `@effect/platform-node`.
