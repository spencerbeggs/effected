---
type: Decision
title: "D1: @effected/engine exists and holds Distribution, Remediation and LaunchContext"
description: A new pure-tier package sits below @effected/cli and @effected/mcp so a consumer's own engine can stamp distribution without depending on a front end.
status: stable
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
verified:
  - by: human:spencer
    at: 2026-09-23T19:50:29Z
  - by: human:spencer
    at: 2026-10-13T21:42:59Z
integrity:
  generated:
    body: 313bdee13d1f5b1c
  verified:
    by: human:spencer
    at: 2026-10-13T21:42:59Z
    content: d486266e3f0fafe4
---

# D1: `@effected/engine` exists and holds `Distribution`, `Remediation` and `LaunchContext`

## Context

Three consumer repos (okfit, vitest-agent, systems/Silk) each hand-roll a
"which carrier package installed this bin" primitive so their front ends
can print `" via <name> <version>"` and their MCP tools can echo it back
in a failure. All three shapes agree closely enough to unify:
`{ name, version }`. Each repo's own **engine** package — the layer
composing its core and vocabulary into shared programs, below its `cli`
and `mcp` front ends — is exactly where the stamping happens, because the
engine is the thing that builds the envelope the distribution rides in.
That forces a placement question: a shared `Distribution` primitive has to
live somewhere a consumer's engine can depend on, and a consumer's engine
is not an application — it may not take a `@effected/cli` dependency, and
`@effected/cli`'s own rule ("nothing in the kit may depend on it except an
application") makes that a hard constraint, not a style preference.

## Decision

A new pure-tier `@effected/engine` package holds `Distribution`,
`DistributionField`, `CurrentDistribution`, `distributionSuffix`,
`Remediation`, and `LaunchContext`. Its only dependency of any kind is
`effect`, declared as a peer. It sits below both `@effected/cli` and
`@effected/mcp` in the dependency graph, and a consumer's own engine package is free to
depend on it directly — the entire reason it exists as a separate package
rather than folding into one of the front ends.

## Alternatives rejected

**`Distribution` only, deferring the rest of the engine.** Rejected
because `Remediation` and `LaunchContext` have the identical placement
problem — an MCP tool failure needs `Remediation` at the same layer a
consumer's engine builds its envelope, and `LaunchContext.projectDir`
resolves a value an engine reads before any front end runs — so shipping
`Distribution` alone would still leave the other two duplicated across
three repos with no home to converge on.

**Deferring the whole engine package**, keeping every primitive as a
skill recipe. Rejected because a recipe cannot be a dependency: a
consumer's engine stamping `distribution` into an envelope needs a real
importable schema and reference, not prose an author re-types per repo.
The bug pattern in the design's motivation — three copies, most of them
carrying a bug — is exactly what a recipe reproduces.

## Consequences

Two kit packages depend on `@effected/engine`: `@effected/mcp`, as a
peer, and `@effected/cli`, as a regular dependency for `CliRuntime.main`'s
`distribution` option ([its own Decision](cli-engine-edge.md)). An edge
from any other kit package to `engine` needs its own Decision. A consumer's engine package gains a legitimate kit
dependency it did not have before, which is the intended effect: it can
stamp `distribution` and build `Remediation` values without smuggling in
a `cli` or `mcp` edge to do it. The package ships nothing that reads
`process`: `LaunchContext.projectDir` takes `env` and `cwd` as plain
values, so the pure tier holds by construction, not by discipline.
