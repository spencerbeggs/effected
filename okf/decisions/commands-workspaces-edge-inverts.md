---
type: Decision
title: "commands' workspaces edge inverts rather than dragging four packages integrated"
description: Why @effected/commands declares LocalExec instead of depending on @effected/workspaces directly.
status: stable
tags: [bundle, architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 3016bd9c75b8daf44d61d79804e95461a97f0390cc5f50d410e5efa9c4ee36c5
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# commands' workspaces edge inverts rather than dragging four packages integrated

## Context

`ToolDiscovery`'s local resolution needs to know how to run a
project-local binary — `pnpm exec`, `npx --no --`, `yarn exec`, `bun x
--no-install` — which means knowing the workspace root and the package
manager. Both of those are `@effected/workspaces`' knowledge, and
`workspaces` is integrated tier.

## Decision

`@effected/commands` declares a narrow `LocalExec` contract in
`packages/commands/src/LocalExec.ts` and requires it in `R`;
`@effected/workspaces` ships the layer that implements it, per the kit's
[general contract-inversion pattern](contract-inversion-default.md). The
contract is deliberately smaller than "the workspaces surface" — an argv
prefix plus a directory (`ExecContext`), not a workspace model.
`LocalExec.prefixes(launcher)` is the single home of the four package
managers' argv (`exec`, `dlx`, script-runner prefixes), so neither package
reimplements the other's knowledge, and `scriptPrefix` is a required
`ExecContext` field rather than an optional one an implementation could
forget.

## Alternatives rejected

- **A direct dependency edge from `commands` to `workspaces`.** Taking
  that edge directly would drag `commands` to integrated tier under the
  kit's dependency policy, and through the `@effected/npm` → `commands`
  edge it would drag `npm`, `lockfiles` (pure tier) and `package-json` up
  a tier with it — four packages, including a pure one, plus pnpm's
  catalog engine, in the tree of anyone who merely wanted to check whether
  `tar` exists.
- **Folding tool discovery into `@effected/workspaces` itself.** Rejected
  because discovery's natural home is beside the runner it probes with
  (`Run`), and a consumer wanting only process-running and discovery
  should not have to take the entire workspace-discovery-and-graph engine
  to get it.

## Consequences

`commands` never touches a path or an ambient `cwd` — that whole question
moves behind the `LocalExec` contract, landing in the package that already
has a policy for it, or in the application at its edge. A consumer with no
monorepo pays nothing: a single-package checkout wires `LocalExec.
layerNone` or `LocalExec.layerFor("npm")` and never installs
`@effected/workspaces`. The dependency graph stays acyclic by construction:
`workspaces` takes the edge on `commands`, and `commands` has no
`@effected/*` edges at all.
