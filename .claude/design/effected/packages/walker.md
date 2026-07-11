---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - config-file.md
---

# @effected/walker design

## Overview

Target design for `@effected/walker`, the **sixth** package migration (step 2 of [migration-playbook.md](../migration-playbook.md)) and a **boundary-tier** package. Walker is path traversal as a small, testable library: ascend a directory chain toward the filesystem root, probe candidates along the way and return the first that satisfies a predicate. It is extracted from code already living inside `@effected/config-file` — `internal/walkUp.ts` (`ascend`, `findUpward`) and the `rootAnchored`/`probeSubpaths` helpers in `ConfigResolver.ts` — so the port is a consolidation, not a new invention.

It is **boundary tier**, not pure. Walker does IO: it reads the filesystem through `effect`-core `FileSystem` and `Path`. It was previously mislabelled pure on the theory that "injecting the probe as a parameter keeps `effect` the only peer" — that argument is retired by the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy). A package that does IO through core platform abstractions is boundary by [R4](../effect-standards.md#dependency-policy), and requiring `FileSystem`/`Path` costs walker nothing in dependencies because both are `effect` core in v4, so it stays tier 2 rather than tier 3.

## Tier and dependencies

**Boundary tier.** `peerDependencies: { effect: "catalog:effect" }`, and **no runtime dependencies**. `FileSystem` and `Path` arrive via the `R` channel from the consumer's platform layer, exactly as in `@effected/config-file` and `@effected/package-json`. Because both services live in `effect` core in v4, requiring them adds no external edge — walker is the cleanest possible boundary profile: `effect`-only peer, zero runtime deps.

This makes walker a concrete proof that the tier-2 boundary is drawn where the taxonomy says: its tests provide `FileSystem` and `Path` entirely from `effect` core, with **no `@effect/platform-node` devDependency at all** (see [Testing](#testing)) — unlike `@effected/config-file`, whose integration tests need a real platform.

## Origin, and a correction: three things, not two

[package-inventory.md](../package-inventory.md) currently claims walker's two sources — `config-file`'s `walkUp.ts` and workspaces-effect's `discovery/glob-core.ts` — are "the same algorithm pointed in opposite directions." **That is false, and this doc corrects it.**

`glob-core.ts` is pure glob **compilation** with no IO — it turns a glob pattern into an anchored matcher and matches strings against it. The downward **enumeration** is a separate loop entirely, living in `WorkspaceDiscoveryLive.resolvePatterns`, which calls `fs.exists` / `fs.readDirectory` inline and raises a workspaces-specific `WorkspaceDiscoveryError`. So there are three distinct things, not two:

1. **Upward traversal** — `walkUp.ts`'s `ascend` / `findUpward` and `ConfigResolver`'s root-anchored discovery. This is walker.
2. **Glob compilation** — `glob-core.ts`, pure string matching. This moves to `@effected/glob` (see [package-inventory.md](../package-inventory.md#internal-packages-no-source-repo)), not walker.
3. **Downward enumeration** — the `resolvePatterns` loop that walks *into* a tree. It is workspaces-specific and stays in `@effected/workspaces` for now.

The genuine shared algorithm is between `findUpward` and `findRoot`, described below — both upward, both "first candidate satisfying a predicate." Downward glob enumeration is **not** in walker v1, and glob matching is `@effected/glob`'s job.

## Scope: upward only

Walker v1 is **upward traversal and nothing else**. No downward enumeration, no glob, no `Context.Service` of its own, and no `Effect.fn` spans. Every public function's error channel is `never` (see [Error handling](#error-handling)); the [observability standard](../effect-standards.md#observability-standards) instruments fallible public boundaries, and walker has none — so instrumenting it would add named spans around operations that cannot fail, which is noise. If a later version grows a fallible surface, spans arrive with it.

## Module layout

One concept module holds the whole library — walker is small enough that a single `Walker.ts` is the honest shape, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept).

```text
packages/walker/
  src/
    Walker.ts            # ~120 lines: the whole library — the Walker namespace object
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

`start` is **required**. Walker never reads `process.cwd()`. A traversal library that silently defaults to the process working directory cannot be tested or reasoned about — the caller who knows where "here" is passes it in. `cwdOf` (config-file's `given ?? process.cwd() ?? "/"` helper) **stays in config-file**; it is a resolver-policy decision, not a traversal one.

## The key insight: firstMatch is the whole algorithm

Today `rootAnchored` calls `findUpward(dirs, (dir) => [dir], isRoot)` — it passes an **identity candidate expansion** and smuggles a root-detection predicate through the `exists` slot. Reading that back: "find the first candidate satisfying an absorbing predicate" **is** the whole algorithm, and everything else is candidate generation.

So `firstMatch` is the single primitive, but only one of the two named operations turns out to be a bare one-liner over it:

- `findRoot = firstMatch(dirs, isRoot)` — a genuine one-line specialization. Candidates are the directories themselves; the predicate is a marker test.
- `findUpward` first **flattens** `dirs.flatMap(candidatesFor)` into one directory-major candidate list, then hands that flat list to `firstMatch(candidates, fs.exists)`. The flattening is not a formality — it *is* the ordering invariant: every candidate in the nearest directory is exhausted before the scan ascends to the next one, so a candidate-major interleave (which would let a distant ancestor's marker beat a nearer directory's) is impossible by construction.

Per-probe absorption (an unreadable ancestor must not abort the scan) then lives in exactly **one** place — `firstMatch` — rather than being re-derived by each caller. The old `probeSubpaths` helper and the hand-passed identity expansion both disappear.

## Wiring: services via R, not parameters

`Path` and `FileSystem` arrive via the `R` channel, never as function parameters. Two reasons make this the right seam rather than a style choice:

- `Path.Path` is **branded** (`readonly [TypeId]`), so a structural `{ dirname, join }` duck type cannot satisfy it — the requirement can only be met by a real `Path` layer.
- `effect` core ships only a **POSIX** `Path.layer`. Whether traversal uses POSIX or win32 semantics is therefore chosen exactly once, by the consumer's platform layer at the edge — not smuggled in per call.

Both `FileSystem` and `Path` live in `effect` core in v4, so requiring them via `R` costs walker nothing in dependencies and keeps it tier 2.

## Error handling

Walker has **no error module**. Every public channel is `never`, and that is a designed contract, not an accident:

- **Probe failures are absorbed per candidate, inside `firstMatch`.** An `EACCES`, `ENOTDIR` or broken-symlink failure on one candidate is caught (`Effect.catch`) and treated as "this candidate did not match", so the scan continues. One unreadable ancestor must never abort the walk — otherwise a permission error deep in the tree would hide a valid root above it. Not-found and cannot-look are deliberately **indistinguishable**: discovery is best-effort. (Surfacing the skipped set to callers was considered and rejected; no consumer wants it.)
- **Defects propagate.** `firstMatch` uses `Effect.catch`, which catches *failures*, not defects. A predicate that `throw`s is programmer error and must surface as a defect, not be silently reinterpreted as "this candidate didn't match". A later refactor to `catchCause` would quietly break this contract — the choice of `catch` over `catchCause` here is load-bearing.
- **A non-positive-integer `maxDepth` is a defect.** The guard is `!Number.isInteger(maxDepth) || maxDepth < 1`, not merely `maxDepth < 1` — `NaN < 1` and `2.5 < 1` are both `false`, so a bare `< 1` check would let `NaN` or a fractional depth silently through. It can only come from code, never from input, so `ascend` raises it as `Effect.die` rather than silently returning an empty chain.

Because the channel is `never`, the walking resolvers in config-file inherit their best-effort guarantee **from walker's type** rather than from a wrapper's prose — see [Consumer impact](#consumer-impact-the-config-file-refactor).

## Hardening

The [hardening-a-parser-port](../effect-standards.md#input-hardening-standards) discipline mostly does **not** apply here: walker parses nothing, has no recursion over untrusted text and no `MAX_NESTING_DEPTH` surface. What it has instead are a few traversal-specific invariants worth stating.

- **`ascend` is a bounded `for` loop, not recursion.** There is no stack-overflow surface. It terminates two ways: `Path.dirname` is a fixpoint at the root (`dirname("/") === "/"`), and `maxDepth = 256` guards against a pathological `Path` implementation that never reaches a fixpoint.
- **`ascend` is lexical, not physical.** `Path.dirname` does string manipulation and does not resolve symlinks, so ascending out of a symlinked directory follows the **given path**, not the real filesystem parent. This is existing behaviour, is correct for config discovery (you want the config nearest the path the user named, not the one nearest the symlink target) and was previously undocumented. It is now an invariant.
- **`firstMatch` stays interruptible.** The loop yields per candidate, so a long scan is cooperatively cancellable.
- **Candidates materialize up front.** `dirs.flatMap(candidatesFor)` builds the full candidate list before probing, bounded by `maxDepth × |subpaths|` — a few hundred strings in practice. The current config-file loop short-circuits per directory instead, so this trades a slightly larger transient array for the single-primitive factoring. The tradeoff is deliberate and cheap at this scale.

## Consumer impact: the config-file refactor

Extracting walker was a real change to the already-merged, previously zero-runtime-dependency `@effected/config-file`. Nothing was published, so the cost was a refactor commit, not a breaking release. The refactor landed as part of this migration.

- **`internal/walkUp.ts` was deleted.** config-file gained `"@effected/walker": "workspace:*"` in both `devDependencies` and `peerDependencies` and **stayed tier 2 by [R3](../effect-standards.md#dependency-policy)** — walker is boundary, and boundary does not propagate. Runtime `dependencies` is still empty. That both-lists declaration became the repo's precedent: when the [config-file consolidation](config-file.md#the-consolidation-2026-07-11) absorbed the three codec adapters, its new `@effected/jsonc` / `yaml` / `toml` edges were declared the same way.
- **`probeSubpaths` (ConfigResolver.ts) disappeared.** It was `findUpward([dir], …)` written longhand; the extracted `firstMatch`/`findUpward` cover it directly.
- **`isGitRoot` / `isWorkspaceRoot` dropped their `(fs, path)` parameters** and `yield*` the services instead, because `findRoot` is generic in `R`. Their error channel tightened from `unknown` to typed: `(dir) => Effect<boolean, PlatformError.PlatformError, FileSystem | Path>`. `isWorkspaceRoot` kept its `try`/`catch` around `JSON.parse` — a parse throw is a defect, and `firstMatch`'s `Effect.catch` absorbs failures, not defects, so removing the `try`/`catch` would leak a defect through that now-typed channel.
- **`absorb` survives only for `explicitPath` / `staticDir` / `systemEtc`**, the three resolvers that call `fs.exists` directly. The three *walking* resolvers no longer need `absorb` — walker's channel is already `never`.
- **Net: exactly one absorbing loop remains in the repo.** The walking resolvers inherit the best-effort guarantee from `firstMatch`'s type rather than from prose scattered across resolver bodies.
- **Migration gate held.** config-file's suite grew from 120 to 124 tests — the pre-existing 120 stayed green unmodified through the refactor, and four new tests closed mutation-proven coverage gaps in `ConfigResolver.int.test.ts` (`stopAt` actually halting an ascent, `rootAnchored` probing only under the anchor, `gitRoot` anchoring on the nearest of nested repos, `systemEtc`'s success path) discovered while validating the extraction, not caused by it.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. Tests live in `packages/walker/__test__/Walker.test.ts` per repo convention. The landed suite is **25 tests**, covering five mutation-proven invariants: per-candidate absorption, defect propagation, `firstMatch` short-circuiting, `findUpward`'s directory-major ordering and the positive-integer `maxDepth` guard.

Walker needs **no platform package**. Tests provide `Path.layer` (POSIX) and `FileSystem.layerNoop({ exists, readFileString })`, both from `effect` core — so there is **no `@effect/platform-node` devDependency**, unlike config-file. This is the concrete proof that the tier-2 boundary is drawn where the taxonomy claims: a boundary package that does real IO can still be tested with core-only layers when the IO surface is small enough.

Required tests:

- **A predicate that fails on candidate 2 still probes candidate 3.** The regression test for the load-bearing per-candidate-absorption invariant, previously enforced only by prose in config-file.
- **A predicate that dies on candidate 2 propagates the defect** — the `catch`-not-`catchCause` boundary.
- **`findRoot` does not let an unreadable ancestor hide a valid root above it** — the config-file `rootAnchored` bug that motivated per-probe absorption, now a walker-level test.
- **`stopAt` is inclusive** — the `stopAt` directory is the last one yielded.
- **`ascend` terminates at the root fixpoint** without hitting `maxDepth`.
- **`maxDepth` truncates** a chain longer than the cap.
- **Nearer directories win** — the first match in ascending order is returned.

**Migration gate held:** config-file's existing 120 tests stayed green **unmodified** through the refactor. The extraction changed internals, not behaviour.

## Build

No `_base` suppression in `savvy.build.ts`. Walker declares **no classes at all** — no `Schema.Class`, no `Context.Service`, no tagged errors — so there is no API-Extractor class-factory `_base` warning to suppress. This is the first migrated package with a genuinely empty suppression list on its own merit, not by widening a narrow rule.
