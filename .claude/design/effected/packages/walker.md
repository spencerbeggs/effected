---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - config-file.md
---

# @effected/walker design

## Overview

`@effected/walker` is upward path traversal as a small, testable library: ascend a directory chain toward the filesystem root, probe candidates along the way and return the first that satisfies a predicate. It is the one absorbing traversal loop in the repo — `@effected/config-file`, `@effected/xdg` and `@effected/workspaces` all discover files through it.

It is **boundary tier**: it does IO, reading the filesystem through `effect`-core `FileSystem` and `Path`. A package that does IO through core platform abstractions is boundary by [R4](../effect-standards.md#dependency-policy), and requiring `FileSystem`/`Path` costs walker nothing in dependencies because both are `effect` core in v4.

## Tier and dependencies

**Boundary tier.** `peerDependencies: { effect }`, and **no runtime dependencies**. `FileSystem` and `Path` arrive via the `R` channel from the consumer's platform layer. This is the cleanest possible boundary profile: `effect`-only peer, zero runtime deps, tested entirely from core layers with no `@effect/platform-node` devDependency (see [Testing](#testing)).

## Scope: upward only

Walker is **upward traversal and nothing else** — no downward enumeration, no glob, no `Context.Service` of its own, and no `Effect.fn` spans. Every public function's error channel is `never` (see [Error handling](#error-handling)); the [observability standard](../effect-standards.md#observability-standards) instruments fallible boundaries and walker has none.

Two adjacent concerns deliberately live elsewhere: **glob compilation** (pattern → matcher, pure string matching) is [@effected/glob](../package-inventory.md#the-packages)'s job, and **downward enumeration** (walking *into* a tree) is workspaces-specific and lives in `@effected/workspaces`. Walker owns only the shared upward algorithm — "first candidate satisfying a predicate."

## Module layout

One concept module holds the whole library — walker is small enough that a single `Walker.ts` is the honest shape, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

```text
packages/walker/
  src/
    Walker.ts            # the whole library — the Walker namespace object
    index.ts             # public surface, re-exports only
  __test__/
    Walker.test.ts
```

## Public surface

A `Walker` namespace object with static functions, matching the `Jsonc` / `ConfigResolver` convention (the file name is the API name).

```ts
export interface AscendOptions {
  readonly stopAt?: string;   // no `| undefined` — exactOptionalPropertyTypes
  readonly maxDepth?: number; // default 256
}

// Ascend from `start` toward the root, yielding each directory (nearest first).
ascend(start: string, options?: AscendOptions):
  Effect<ReadonlyArray<string>, never, Path.Path>;

// The single primitive: first candidate satisfying an absorbing predicate.
firstMatch<E, R>(
  candidates: ReadonlyArray<string>,
  predicate: (candidate: string) => Effect<boolean, E, R>,
): Effect<Option<string>, never, R>;

// firstMatch(dirs.flatMap(candidatesFor), fs.exists)
findUpward(
  dirs: ReadonlyArray<string>,
  candidatesFor: (dir: string) => ReadonlyArray<string>,
): Effect<Option<string>, never, FileSystem.FileSystem>;

// firstMatch(dirs, isRoot)
findRoot<E, R>(
  dirs: ReadonlyArray<string>,
  isRoot: (dir: string) => Effect<boolean, E, R>,
): Effect<Option<string>, never, R>;
```

`start` is **required**. Walker never reads `process.cwd()` — a traversal library that silently defaults to the process working directory cannot be tested or reasoned about, so the caller who knows where "here" is passes it in.

## firstMatch is the whole algorithm

"Find the first candidate satisfying an absorbing predicate" **is** the whole algorithm; everything else is candidate generation. So `firstMatch` is the single primitive, and the two named operations layer over it:

- `findRoot = firstMatch(dirs, isRoot)` — a one-line specialization. Candidates are the directories themselves; the predicate is a marker test.
- `findUpward` first **flattens** `dirs.flatMap(candidatesFor)` into one directory-major candidate list, then hands that to `firstMatch(candidates, fs.exists)`. The flattening *is* the ordering invariant: every candidate in the nearest directory is exhausted before the scan ascends, so a distant ancestor's marker can never beat a nearer directory's.

Per-probe absorption (an unreadable ancestor must not abort the scan) lives in exactly one place — `firstMatch`.

## Wiring: services via R, not parameters

`Path` and `FileSystem` arrive via the `R` channel, never as function parameters. Two reasons make this the right seam:

- `Path.Path` is **branded** (`readonly [TypeId]`), so a structural `{ dirname, join }` duck type cannot satisfy it — the requirement can only be met by a real `Path` layer.
- `effect` core ships only a **POSIX** `Path.layer`. Whether traversal uses POSIX or win32 semantics is therefore chosen exactly once, by the consumer's platform layer at the edge.

Both services live in `effect` core in v4, so requiring them via `R` costs walker nothing in dependencies and keeps it tier 2.

## Error handling

Walker has **no error module**. Every public channel is `never`, a designed contract:

- **Probe failures are absorbed per candidate, inside `firstMatch`.** An `EACCES`, `ENOTDIR` or broken-symlink failure on one candidate is caught (`Effect.catch`) and treated as "this candidate did not match," so the scan continues. Not-found and cannot-look are deliberately indistinguishable: discovery is best-effort.
- **Defects propagate.** `firstMatch` uses `Effect.catch`, which catches *failures*, not defects. A predicate that `throw`s is programmer error and must surface as a defect. The choice of `catch` over `catchCause` is load-bearing — a refactor to `catchCause` would quietly break this contract.
- **A non-positive-integer `maxDepth` is a defect.** The guard is `!Number.isInteger(maxDepth) || maxDepth < 1`, not a bare `< 1` (which lets `NaN` and `2.5` through). It can only come from code, so `ascend` raises it as `Effect.die`.

Because the channel is `never`, the walking resolvers in config-file inherit their best-effort guarantee from walker's type rather than from wrapper prose.

## Hardening

The [hardening-a-parser-port](../effect-standards.md#input-hardening-standards) discipline mostly does not apply — walker parses nothing and has no recursion over untrusted text. The traversal-specific invariants:

- **`ascend` is a bounded `for` loop, not recursion.** No stack-overflow surface. It terminates two ways: `Path.dirname` is a fixpoint at the root (`dirname("/") === "/"`), and `maxDepth = 256` guards a pathological `Path` implementation that never reaches a fixpoint.
- **`ascend` is lexical, not physical.** `Path.dirname` does string manipulation and does not resolve symlinks, so ascending out of a symlinked directory follows the **given path**, not the real filesystem parent — correct for config discovery (you want the config nearest the path the user named).
- **`firstMatch` stays interruptible.** The loop yields per candidate, so a long scan is cooperatively cancellable.
- **Candidates materialize up front.** `dirs.flatMap(candidatesFor)` builds the full candidate list before probing, bounded by `maxDepth × |subpaths|` — a few hundred strings in practice. The slightly larger transient array buys the single-primitive factoring.

## Consumer relationship

Walker is the repo's single absorbing traversal loop. Config-file's walking resolvers (`gitRoot`, `workspaceRoot`, root-anchored discovery) and xdg's `XdgConfig.resolver` build their candidate lists and hand them to `firstMatch`/`findUpward`/`findRoot`, inheriting the `never` channel and per-candidate absorption from walker's type. `isGitRoot` / `isWorkspaceRoot`-style marker predicates `yield*` the `FileSystem`/`Path` services (`findRoot` is generic in `R`), so their error channel is typed (`PlatformError`, `FileSystem | Path`) rather than `unknown`. A predicate wrapping `JSON.parse` keeps its own `try`/`catch` — a parse throw is a defect and `firstMatch`'s `Effect.catch` absorbs failures, not defects.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. Tests live in `packages/walker/__test__/Walker.test.ts`.

Walker needs **no platform package**: tests provide `Path.layer` (POSIX) and `FileSystem.layerNoop({ exists, readFileString })`, both from `effect` core. A boundary package that does real IO can still be tested with core-only layers when the IO surface is small enough.

The mutation-proven invariants the suite pins:

- A predicate that fails on candidate 2 still probes candidate 3 (per-candidate absorption).
- A predicate that dies on candidate 2 propagates the defect (the `catch`-not-`catchCause` boundary).
- `findRoot` does not let an unreadable ancestor hide a valid root above it.
- `stopAt` is inclusive — the `stopAt` directory is the last yielded.
- `ascend` terminates at the root fixpoint without hitting `maxDepth`, and `maxDepth` truncates a chain longer than the cap.
- Nearer directories win — the first match in ascending order is returned.

## Build

`savvy.build.ts` carries an empty suppression list. Walker declares no classes at all — no `Schema.Class`, no `Context.Service`, no tagged errors — so there is no API-Extractor class-factory `_base` warning to suppress.
