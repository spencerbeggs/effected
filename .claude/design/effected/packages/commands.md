---
status: current
module: effected
category: architecture
created: 2026-07-14
updated: 2026-07-14
last-synced: 2026-07-14
completeness: 80
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../roadmap.md
  - git.md
  - workspaces.md
  - runtimes.md
  - npm.md
---

# @effected/commands design

## Overview

Target design for `@effected/commands`, a **boundary-tier** package and the kit's **one subprocess seam**. It was already on the roadmap as a post-`0.1.0` generalization of silk-effects' ToolDiscovery service ([roadmap.md](../roadmap.md#effectedcommands)); the point-in-time workstream (2026-07-14) pulled **half** of it forward onto the `0.1.0` gate. This document records the split and designs the half that ships now.

The package has two planes:

1. **The runner core — on the `0.1.0` gate.** A structured `Command` value model plus a `CommandRunner` service: the single place in the kit where a subprocess is spawned. This is `@effected/workspaces`' `GitReader.run` generalized, and it exists now because [`@effected/git`](git.md) needs it as its foundation.
2. **Tool discovery — stays post-`0.1.0`.** The ToolDiscovery generalization the roadmap entry describes: PATH-vs-local tool resolution via the detected package manager's exec, configurable version extraction, source constraints and mismatch policies. Nothing on the gate consumes it; it keeps its roadmap slot and arrives in its own spec → plan → implement cycle.

Names and exact signatures below are design-level; they are confirmed at the effect-v4-planning gate when implementation starts, verified against the installed `effect` beta.

## Why the kit owns a subprocess seam at all

This is the runtime-resolver finding, restated once more because it is the entire reason this package exists: **`effect` core declares service abstractions it implements for no runtime.** Core ships a `ChildProcessSpawner` contract in `effect/unstable/process` and no Node implementation; the implementations live in `@effect/platform-node`, and a library that depends on that package becomes tier 3 for every consumer ([runtimes.md](runtimes.md#the-effectcli-verdict-dead-on-v4-and-not-needed), [workspaces.md](workspaces.md#gitreader--the-subprocess-seam)).

`@effected/workspaces` and `@effected/runtimes` independently hit this wall and drew the same conclusion — own a seam. Workspaces' seam is `GitReader`: a small contract with a `layerNode` default over `node:child_process.execFile`. That was the right shape with one flaw the kit can now see: **the seam is git-flavored when nothing about it is git-specific.** The moment a second subprocess consumer appears (`@effected/git` itself, then tool discovery, then systems' structured command running), each would either grow its own `node:child_process` layer or borrow git's. One seam, many flavored wrappers, is the honest factoring — so the seam generalizes and moves here, and `GitReader` dissolves into it (see [git.md](git.md#origin-gitreader-dissolves)).

## Tier and dependencies

**Boundary tier**, argued against the [dependency policy](../effect-standards.md#dependency-policy) explicitly:

- **R1** — `peerDependencies: { effect: "catalog:effect" }`, **no external runtime dependencies**, and — for the runner core — **no `@effected/*` edges at all**. `node:child_process` appears only inside `layerNode` and is a Node built-in, not a dependency; built-ins do not affect tier (the precedent is recorded in [workspaces.md](workspaces.md), which documents its two Node-only overlays the same way).
- **R2** — moot: nothing tier-3 is taken.
- **R3** — consumers of this package stay whatever tier they were; the subprocess IO is discharged by choosing a runner layer at the edge.
- **R4** — the package performs IO itself (spawning), however thin, which is precisely the boundary-tier definition. It is not integrated because integrated is defined by *dependencies alone*, and there are none.

The zero-`@effected`-edges rule for the runner core is load-bearing, not incidental — see [the cycle](#the-cycle-and-the-contract-inversion-that-kills-it).

## Public surface: the runner core

### `Command` — a structured, inspectable value

A `Schema.Class` describing one invocation: `executable`, `args`, and optional `cwd`, `env` (an overlay onto — never a replacement of — the inherited environment) and `timeout`. A `Command` is data: constructing one spawns nothing, so a consumer (or a test) can build, inspect, compare and log commands without touching a process table. This is what lets `@effected/git` expose pure `GitCommand.show(ref, path)`-style constructors whose output is assertable in a unit test with no runner in sight.

### `CommandRunner` — the seam

A `Context.Service` with the smallest surface that covers the known consumers:

- `run(command)` — spawn, wait, capture; succeed with the completed result (stdout, stderr, exit code) when the process **ran**, whatever its exit code. Interpreting a non-zero exit is the *caller's* domain decision (git encodes meaning into exit codes that are not failures of the runner), so the runner's error channel carries only spawn-level failure.
- `available(executable)` — can this executable be found and executed at all. Generalizes `GitReader.available`, and is the primitive the post-`0.1.0` tool-discovery plane builds on.

Two hard-won details from `GitReader.layerNode` are preserved as runner capabilities rather than re-derived per consumer: a per-command **timeout** (a hung subprocess must not hang the fiber forever) and caller-controlled **env overlay** (git pins `LC_ALL=C` through it so stderr classification is locale-stable — the *pinning* is git's decision, the *mechanism* is the runner's).

### Layers

- **`layerNode`** — the shipped default, over `node:child_process.execFile`. The only module in the package that imports a `node:` built-in.
- **`layerBun`** — later, when a Bun consumer exists; the roadmap entry's "structured command running with Node and Bun" names it. Designed-for, not shipped blind.
- Tests and non-spawning consumers mock with `Layer.succeed` / `Layer.mock` — the same discipline `GitReader` proved (change-detection tests need no git repository; command tests need no processes).

## Errors

One typed error for the runner's own channel — design-level name `CommandSpawnError` — carrying `executable`, `args`, `cwd` and the underlying cause: the process could not be started (missing executable, EACCES, spawn-time failure) or violated a runner-level bound (timeout). A process that starts and exits non-zero is **not** this error; it is a successful `run` whose result the caller interprets. Collapsing the two would force every consumer to string-match its way back out — the exact failure mode [git.md](git.md#errors-classification-happens-once) exists to prevent one level up.

## The cycle, and the contract inversion that kills it

The original roadmap entry says tool discovery "peers on `@effected/workspaces` for PackageManagerDetector/WorkspaceRoot". That note predates `@effected/git`. With the new edges — workspaces → git (ChangeDetector, WorkspaceSnapshots) and git → commands — keeping it would close a cycle:

```text
workspaces ──► git ──► commands ──► workspaces   ✗
```

The resolution is the pattern the kit already uses at exactly this shape, `@effected/npm`: **commands owns the contract, workspaces implements it.** When the tool-discovery plane lands, the "resolve a tool through the detected package manager" capability is a contract service defined here, and `@effected/workspaces` — which owns `PackageManagerDetector` and `WorkspaceRoot` — ships the implementing layer, just as it implements npm's `CatalogResolver` and `WorkspaceResolver` today ([npm.md](npm.md), [workspaces.md](workspaces.md)). The runner core needs none of this; its zero-`@effected`-edges rule is what makes the inversion possible. The roadmap entry is amended to record the inversion.

## Module layout

```text
packages/commands/
  src/
    Command.ts        # the Command value model
    CommandRunner.ts  # CommandRunner service contract, CommandSpawnError, layerNode
    index.ts          # public surface, re-exports only
  __test__/
    CommandRunner.test.ts       # contract semantics over a mock layer
    e2e/CommandRunner.e2e.test.ts  # one real spawn through layerNode
```

The tool-discovery plane adds its own concept modules when it arrives; it does not widen these.

## Observability

Named spans on public fallible boundaries only, per the [observability standard](../effect-standards.md#observability-standards): `CommandRunner.run` and `CommandRunner.available`, annotated with the executable and cwd — never the full argv, which can carry refs, paths and tokens chosen by callers. No logging, no metrics; the library stays telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/` per repo convention.

- **Contract tests over a mock runner** (`Layer.succeed`): the non-zero-exit-is-success rule, the timeout bound, env overlay semantics (overlay, not replace).
- **One e2e through `layerNode`**, spawning a trivial real process, proving the seam end to end: a successful run, a non-zero exit surfaced as a result, and a missing executable surfaced as `CommandSpawnError`.
- The mutate-the-edges discipline applies to the classification boundary: a test must pin that a non-zero exit does **not** produce `CommandSpawnError` — that is the invariant a well-meaning refactor is most likely to break.

## Consumers

- **`@effected/git`** — now; the reason the runner core is on the gate ([git.md](git.md)).
- **`@effected/workspaces`** — transitively through git; its `GitReader` dissolves rather than duplicating the seam.
- **Tool discovery** — post-`0.1.0`, per the amended roadmap entry, including the savvy-web/systems consumers whose ToolDiscovery pattern the roadmap surveyed.
