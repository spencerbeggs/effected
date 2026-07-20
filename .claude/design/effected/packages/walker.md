---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-20
last-synced: 2026-07-20
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../formatter-convention.md
  - config-file.md
  - glob.md
---

# @effected/walker design

## Overview

`@effected/walker` is path traversal as a small, testable library. Two directions: **upward**, ascend a directory chain toward the filesystem root and return the first candidate satisfying a predicate; **downward**, expand a compiled glob pattern under a directory and return the matching files. A third module, [`compileAndExpand`](#compileandexpand--the-recipe-seam), owns the compile-plus-expand recipe over the downward walk. The upward walk is the one absorbing traversal loop in the repo — `@effected/config-file`, `@effected/xdg` and `@effected/workspaces` all discover files through it.

It is **boundary tier**: it does IO, reading the filesystem through `effect`-core `FileSystem` and `Path`. A package that does IO through core platform abstractions is boundary by [R4](../effect-standards.md#dependency-policy), and requiring `FileSystem`/`Path` costs walker nothing in dependencies because both are `effect` core in v4.

## Tier and dependencies

**Boundary tier.** `peerDependencies: { effect, @effected/glob }`, and **no runtime dependencies**. `FileSystem` and `Path` arrive via the `R` channel from the consumer's platform layer.

The `@effected/glob` peer was **type-and-property only** until `compileAndExpand`: `descend` imports `GlobPattern` as a type and reads its metadata getters and `matches()`, and that is still all `Descend.ts` does. `Expand.ts` value-imports `GlobPattern.compileResult` and `GlobPatternError`, because owning the compile step is the whole point of that module. The dependency graph is unchanged — the peer was already declared — but the claim to record is narrower now: **`descend` alone is type-only**, so a consumer that imports only `descend` still pulls no engine, while one that imports `compileAndExpand` does. The boundary profile is otherwise intact: no `@effect/platform-node` devDependency, tested entirely from core layers (see [Testing](#testing)).

## Scope: both directions, one shared discipline

Walker owns **path traversal**, and no `Context.Service` of its own. Pattern → matcher stays [@effected/glob](../package-inventory.md#the-packages)'s job: walker is **semantics-free** about matching, reading only the compiled pattern's `hasMagic` / `negated` / `enumerationPrefix` / `crossesSegments` and calling `matches`. Dotfile behavior, case folding and every other option ride in on the pattern and are never re-derived here — `compileAndExpand` *calls* glob's compiler with options the caller supplies, which is delegation rather than an exception to that rule.

Downward enumeration [used to be out of scope](#the-downward-walk-descend), on the theory that walking *into* a tree was workspaces-specific. It is not: glob is a pure matching engine with no walker, and workspaces' enumerator was internal and package-dir-specific, so "files matching a glob under a directory" had no home. `descend` is that home, and it is the package's second concept module.

The two directions do **not** share an error posture — see [Error handling](#error-handling). That asymmetry is the package's most load-bearing design decision.

## Module layout

Two directions and one recipe, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

```text
packages/walker/
  src/
    Walker.ts            # upward — the Walker namespace object
    Descend.ts           # downward — descend, DescendOptions, DescendError
    Expand.ts            # the recipe — compileAndExpand, GlobExpansionError
    index.ts             # public surface, re-exports only
  __test__/
    Walker.test.ts
    Descend.test.ts
    Expand.test.ts
    fixtures.ts
```

`descend` and `compileAndExpand` are **bare functions**, not members of the `Walker` namespace object: they are different algorithms with a different error posture, and folding either into `Walker` would imply it shares the namespace's `never`-channel contract.

## Public surface

A `Walker` namespace object with static functions, matching the `Jsonc` / `ConfigResolver` convention (the file name is the API name).

```ts
export interface AscendOptions {
  readonly stopAt?: string;   // absolute; compared resolved. Relative dies.
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

`start` is **required**. Walker never reads `process.cwd()` — a traversal library that silently defaults to the process working directory cannot be tested or reasoned about, so the caller who knows where "here" is passes it in. `descend`'s `cwd` is required for the same reason.

Downward, a bare function alongside the namespace:

```ts
export interface DescendOptions {
  readonly cwd: string;                      // required — absolute, never process.cwd()
  readonly maxDepth?: number;                // default 256
  readonly prune?: ReadonlyArray<string>;    // default ["node_modules", ".git"]; a custom list REPLACES it
  readonly onUnreadable?: "fail" | "skip";   // default "fail"
}

// Expand a compiled pattern to matching FILE paths, cwd-relative, POSIX, sorted.
descend(pattern: GlobPattern, options: DescendOptions):
  Effect<ReadonlyArray<string>, DescendError, FileSystem.FileSystem | Path.Path>;
```

## firstMatch is the whole algorithm

"Find the first candidate satisfying an absorbing predicate" **is** the whole algorithm; everything else is candidate generation. So `firstMatch` is the single primitive, and the two named operations layer over it:

- `findRoot = firstMatch(dirs, isRoot)` — a one-line specialization. Candidates are the directories themselves; the predicate is a marker test.
- `findUpward` first **flattens** `dirs.flatMap(candidatesFor)` into one directory-major candidate list, then hands that to `firstMatch(candidates, fs.exists)`. The flattening *is* the ordering invariant: every candidate in the nearest directory is exhausted before the scan ascends, so a distant ancestor's marker can never beat a nearer directory's.

Per-probe absorption (an unreadable ancestor must not abort the scan) lives in exactly one place — `firstMatch`.

## The `ascend` ceiling fails closed

`stopAt` is compared in **resolved form on both sides** and stays **inclusive**. Raw string equality was a **fail-open** bug: an unnormalized ceiling matched nothing, so the ascent ran to the filesystem root — the unbounded walk the option exists to prevent — with no error to notice it by. Both sides go through `resolve` because normalizing only the ceiling desynchronizes it from an unnormalized chain element (`/a/b/.` names `/a/b`). Normalization is idempotent, so a caller that already resolves is unaffected, and it governs the **comparison only**: the chain returned is still the lexical one derived from `start`, because rewriting it would break the lexical contract for every caller passing no ceiling at all.

A **relative** ceiling is a **defect**, not a typed failure, and is never resolved against `process.cwd()`. Two reasons, and the second is the load-bearing one:

- Resolving it would let the same `stopAt` name different directories in a lint-staged hook, a CLI run from a package directory and a test runner — the fail-open class again, through a different door. This is why `ascend` reads `process.cwd()` nowhere.
- **Never "upgrade" this to a typed error.** [`@effected/config-file`](config-file.md)'s resolver contract absorbs every typed failure into `Option.none()`, so a typed rejection would be swallowed there and re-emerge as a clean-looking "no config found" — precisely the silent wrong answer the guard exists to close. `Effect.catch` does not catch defects, so only a defect survives that absorption, and a test reconstructs the absorbing caller to pin it.

Only the **ceiling** is constrained: a relative `start` still ascends to the relative root, and a test pins that the rejection was not over-applied. Absoluteness is judged by the injected `Path`, so the win32 layer accepts `C:\repo`.

## The downward walk (`descend`)

The descent is a **worklist, not a recursion** — it cannot overflow the stack — dequeued by a head index rather than `Array.shift()`, which re-indexes the whole array on every dequeue and turns a large walk quadratic.

What earns a filesystem read is decided by the pattern's metadata, and two cases are worth recording because they are not obvious:

- **A literal pattern (no magic, not negated) never walks at all**: one stat decides, and the result is `[source]` for a file or `[]` otherwise.
- **A pattern that cannot match below one level never descends.** `crossesSegments: false` reads a single level.
- **A negated pattern walks from `cwd` and always deep-walks, regardless of `crossesSegments`.** This is the subtle one. `enumerationPrefix` is computed from the *inner* pattern, but `matches()` **inverts** — so a negated pattern matches everything the inner pattern does not, and its matches can land arbitrarily deep and *outside the prefix*. Both halves matter: the base is `""` (walking from the inner prefix silently omits every match outside it — the initial implementation got exactly this wrong) and the walk condition is `crossesSegments || negated`, never `crossesSegments` alone. See [glob's note](glob.md#public-surface) that `enumerationPrefix` is meaningful for non-negated patterns only.
- **Patterns never escape `cwd`.** A pattern that lexically climbs above the root via `..` segments (a literal target or an enumeration base) is zero matches, refused before any filesystem access — walked paths never contain `..`, so nothing such a pattern could match is ever produced, and a walker documented as rooted at `cwd` must not read (or stat) above it.

Zero matches is a **normal glob answer, not an error**: a missing literal path and a missing base directory both read as `[]`. Only files match — a symlink counts when it stat-resolves to a file (`stat` follows links, as node's does), a dangling symlink does not, and a symlinked **directory is never descended** for cycle safety, detected by a `readLink` success-probe. A directory that vanishes between its parent's listing and its own read is a benign race and reads as empty in both `onUnreadable` modes.

Output is sorted by cwd-relative POSIX path — an unsorted enumeration is a reproducibility hazard for every downstream consumer that hashes or diffs it.

## `compileAndExpand` — the recipe seam

`descend` answers "which files match this **compiled** pattern". `compileAndExpand` (in `Expand.ts`) answers "which files match this pattern **source**", and exists because the seam between the two — compile, fold the compile error, expand, fold the descend error — was small enough that every consumer wrote it, and wrote it differently. The dogfood consumer wrote four differently-shaped error folds for one pattern inside a single package, and the fan-out produced a real bug: two divergent `dot` semantics with nothing making the divergence visible. That is the failure this module removes, and it is the same argument the [formatter convention](../formatter-convention.md#why-a-convention-and-not-four-local-answers) makes about unowned seams.

Three decisions carry the design:

- **`options.glob` is required.** Matching semantics — `dot` above all — are what two call sites most easily disagree about, and an optional field invites exactly the divergence above. Required means every call site states its dialect in its own source, so a disagreement is a visible difference between two spellings rather than the absence of one. `GlobPatternOptions.make({})` is how a caller says "the defaults" deliberately.
- **One error, both causes intact.** `GlobExpansionError` carries the underlying `GlobPatternError | DescendError` in `cause` rather than flattening it to a string, with a derived `stage` getter for callers that only need the phase. A caller catches one tag; a caller that needs the guard's `limit`/`actual` or the descent's `path` still has them. `cause` is also the native `Error` cause, so chaining works unwired.
- **`FileSystem` and `Path` stay in `R`, deliberately** — even though hand-providing them is the friction this recipe otherwise removes. `FileSystem` *cannot* be provided: a library that picks its own filesystem cannot be tested against a fixture tree. Given that, providing `Path` internally saves the caller no layer and actively breaks win32, joining POSIX-style against a win32 filesystem. The consumer's platform layer stays the single place that choice is made — the same rule as [below](#wiring-services-via-r-not-parameters).

Everything `descend` documents about traversal holds unchanged here, because this delegates to it. Zero matches stays a normal answer: a missing base directory, a pattern climbing above `cwd` and a pattern that simply matches nothing are all `[]`, not failures.

## Wiring: services via R, not parameters

`Path` and `FileSystem` arrive via the `R` channel, never as function parameters. Two reasons make this the right seam:

- `Path.Path` is **branded** (`readonly [TypeId]`), so a structural `{ dirname, join }` duck type cannot satisfy it — the requirement can only be met by a real `Path` layer.
- `effect` core ships only a **POSIX** `Path.layer`. Whether traversal uses POSIX or win32 semantics is therefore chosen exactly once, by the consumer's platform layer at the edge.

Both services live in `effect` core in v4, so requiring them via `R` costs walker nothing in dependencies and keeps it tier 2.

## Error handling

**The two directions have deliberately opposite error postures.** Absorption is not a house style to apply uniformly — it is a claim about what a failed read *means*, and the meaning inverts with direction.

### Upward: every channel is `never`

- **Probe failures are absorbed per candidate, inside `firstMatch`.** An `EACCES`, `ENOTDIR` or broken-symlink failure on one candidate is caught (`Effect.catch`) and treated as "this candidate did not match," so the scan continues. Not-found and cannot-look are deliberately indistinguishable: discovery is best-effort.
- **Defects propagate.** `firstMatch` uses `Effect.catch`, which catches *failures*, not defects. A predicate that `throw`s is programmer error and must surface as a defect. The choice of `catch` over `catchCause` is load-bearing — a refactor to `catchCause` would quietly break this contract.
- **A non-positive-integer `maxDepth` is a defect.** The guard is `!Number.isInteger(maxDepth) || maxDepth < 1`, not a bare `< 1` (which lets `NaN` and `2.5` through). It can only come from code, so `ascend` raises it as `Effect.die`.
- **A relative `stopAt` is a defect too**, and is never resolved against `process.cwd()` — see [the ceiling](#the-ascend-ceiling-fails-closed). Same line as `maxDepth`: malformed *input* fails typed, statically-wrong *wiring* dies.

Because the channel is `never`, the walking resolvers in config-file inherit their best-effort guarantee from walker's type rather than from wrapper prose.

### Downward: `DescendError`, the package's first typed error

`descend` fails typed, and **must not** inherit the upward absorption posture. The asymmetry is the point:

- Upward, an unreadable ancestor is one candidate that did not match; the scan can still succeed above it, and the answer stays correct.
- Downward, a swallowed subtree is **silently missing membership dressed as an empty result**. The caller cannot tell "no files matched" from "I could not look," and every consumer that acts on the answer — publishing, hashing, change detection — acts on a quietly wrong set.

So `onUnreadable` defaults to `"fail"`. `"skip"` exists for callers who genuinely want best-effort, but it must be **asked for**, never assumed. Depth exhaustion is likewise a typed `depthExceeded` failure, never a truncation — silent truncation silently changes match semantics.

```ts
class DescendError extends Schema.TaggedErrorClass<DescendError>()("DescendError", {
  pattern: Schema.String,
  reason: Schema.Literals(["unreadableDirectory", "depthExceeded"]),  // Literals, not Literal
  path: Schema.String,        // relative to cwd; "" is the walk's base
  limit: Schema.optionalKey(Schema.Number),
})
```

`Schema.Literals`, not `Schema.Literal`: the v3 variadic `Literal` **silently ignores every argument after the first** in the beta, so a `Literal("a", "b")` union quietly narrows to `"a"`. An invalid `maxDepth` stays a defect, exactly as in `ascend`.

## Hardening

The [hardening-a-parser-port](../effect-standards.md#input-hardening-standards) discipline mostly does not apply — walker parses nothing and has no recursion over untrusted text. The traversal-specific invariants:

- **`ascend` is a bounded `for` loop, not recursion.** No stack-overflow surface. It terminates two ways: `Path.dirname` is a fixpoint at the root (`dirname("/") === "/"`), and `maxDepth = 256` guards a pathological `Path` implementation that never reaches a fixpoint.
- **`ascend` is lexical, not physical.** `Path.dirname` does string manipulation and does not resolve symlinks, so ascending out of a symlinked directory follows the **given path**, not the real filesystem parent — correct for config discovery (you want the config nearest the path the user named).
- **`firstMatch` stays interruptible.** The loop yields per candidate, so a long scan is cooperatively cancellable.
- **Candidates materialize up front.** `dirs.flatMap(candidatesFor)` builds the full candidate list before probing, bounded by `maxDepth × |subpaths|` — a few hundred strings in practice. The slightly larger transient array buys the single-primitive factoring.

## Consumer relationship

Walker is the repo's single absorbing traversal loop. Config-file's walking resolvers (`gitRoot`, `workspaceRoot`, root-anchored discovery) and xdg's `XdgConfig.resolver` build their candidate lists and hand them to `firstMatch`/`findUpward`/`findRoot`, inheriting the `never` channel and per-candidate absorption from walker's type. `isGitRoot` / `isWorkspaceRoot`-style marker predicates `yield*` the `FileSystem`/`Path` services (`findRoot` is generic in `R`), so their error channel is typed (`PlatformError`, `FileSystem | Path`) rather than `unknown`. A predicate wrapping `JSON.parse` keeps its own `try`/`catch` — a parse throw is a defect and `firstMatch`'s `Effect.catch` absorbs failures, not defects.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. Tests live in `packages/walker/__test__/`, one suite per concept module, with the descend suite's in-memory trees factored into `fixtures.ts`.

Walker needs **no platform package, even for `descend`**: tests provide `Path.layer` (POSIX) and `FileSystem.layerNoop`, both from `effect` core. A boundary package that does real IO can still be tested with core-only layers when the IO surface is small enough — and `descend` did not change that, it only raised the bar for the fake. The `layerNoop` tree must be faithful to the node backend exactly where `descend` reads it: `stat` **follows** symlinks (a link to a file stats as a `File`; a dangling link fails `NotFound`), and `readLink` succeeds **only** on links, which is the walker's is-this-a-symlink probe. A `layer(...)` boundary cannot vary per test, so each distinct tree gets its own block.

The mutation-proven invariants the suite pins:

- A predicate that fails on candidate 2 still probes candidate 3 (per-candidate absorption).
- A predicate that dies on candidate 2 propagates the defect (the `catch`-not-`catchCause` boundary).
- `findRoot` does not let an unreadable ancestor hide a valid root above it.
- `stopAt` is inclusive, and stops at the ancestor it *names* rather than the string it is spelled with — an unnormalized ceiling no longer runs past its target.
- A relative `stopAt` dies, and survives the absorbing config-file caller reconstructed in the suite; a relative `start` still walks.
- `ascend` terminates at the root fixpoint without hitting `maxDepth`, and `maxDepth` truncates a chain longer than the cap.
- Nearer directories win — the first match in ascending order is returned.

## Build

`savvy.build.ts` carries the one narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }`, for the synthesized bases of the `DescendError` and `GlobExpansionError` class factories (effect-api-extractor-bases). **Never widen it** — the pattern is scoped to `_base` precisely so a genuinely forgotten export still fails the gate. Walker declared no classes at all until `DescendError`; those two are still the only ones.
