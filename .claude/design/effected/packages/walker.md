---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-08-16
last-synced: 2026-08-16
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../formatter-convention.md
  - config-file.md
  - glob.md
  - xdg.md
  - memfs.md
---

# @effected/walker design

## Overview

`@effected/walker` is path traversal as a small, testable library. Two directions: **upward**, ascend a directory chain toward the filesystem root and return the first candidate satisfying a predicate; **downward**, expand a compiled glob pattern under a directory and return the matching files. A third module owns the [compile-plus-expand recipe](#compileandexpand--the-recipe-seam) over the downward walk.

The upward walk is the repo's **one absorbing traversal loop** — [config-file](config-file.md), [xdg](xdg.md) and `@effected/workspaces` all discover files through it.

The two directions do **not** share an error posture. That asymmetry is the package's most load-bearing design decision — see [Error handling](#error-handling).

## Tier and dependencies

**Boundary tier.** `peerDependencies` is `effect` and `@effected/glob`; there are **no runtime dependencies**. `FileSystem` and `Path` arrive via the `R` channel from the consumer's platform layer, and a package that does IO through core platform abstractions is boundary by [R4](../effect-standards.md#dependency-policy). Both services are `effect` core in v4, so requiring them costs walker nothing in dependencies.

The `@effected/glob` edge is asymmetric across the two modules, and the distinction matters for consumers: **`descend` alone is type-and-property only** — it imports `GlobPattern` as a type and reads its metadata getters and `matches()` — so a consumer importing only `descend` pulls no engine. `compileAndExpand` value-imports glob's compiler, because owning the compile step is the whole point of that module.

The boundary profile is otherwise intact: no platform-node devDependency, tested entirely from core layers.

## Scope

Walker owns **path traversal**, and defines no `Context.Service` of its own. Pattern → matcher stays [@effected/glob](glob.md)'s job: walker is **semantics-free** about matching, reading only the compiled pattern's metadata and calling `matches`. Dotfile behavior, case folding and every other option ride in on the pattern and are never re-derived here — `compileAndExpand` *calls* glob's compiler with options the caller supplies, which is delegation rather than an exception to that rule.

Downward enumeration lives here because it had nowhere else to live: glob is a pure matching engine with no walker, and a consumer's private enumerator is package-specific by construction. "Files matching a glob under a directory" is the gap `descend` fills.

## Module layout

Two directions and one recipe, per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept) — `Walker.ts` (upward), `Descend.ts` (downward) and `Expand.ts` (the recipe), plus the re-export-only `index.ts`. See `src/` for the exact signatures.

`descend` and `compileAndExpand` are **bare functions**, not statics on the `Walker` class: they are different algorithms with a different error posture, and folding either into `Walker` would imply it shares that class's `never`-channel contract. `Walker` itself is a static class with a private constructor, not an `as const` object — an `as const` object's member types are inferred in the built `.d.ts` and lose their TSDoc entirely, while a class's `static readonly` declarations keep it ([house container form](../effect-standards.md#a-sanctioned-grouped-statics-container-is-a-static-class-not-an-as-const-object)).

**A start directory is always required.** Walker never reads `process.cwd()` — a traversal library that silently defaults to the process working directory cannot be tested or reasoned about, so the caller who knows where "here" is passes it in. `descend`'s `cwd` is required for the same reason.

## firstMatch is the whole algorithm

"Find the first candidate satisfying an absorbing predicate" **is** the whole algorithm; everything else is candidate generation. So `firstMatch` is the single primitive, and the two named operations layer over it:

- `findRoot` is a one-line specialization — candidates are the directories themselves, the predicate is a marker test.
- `findUpward` first **flattens** each directory's candidates into one directory-major list, then hands that to `firstMatch`. The flattening *is* the ordering invariant: every candidate in the nearest directory is exhausted before the scan ascends, so a distant ancestor's marker can never beat a nearer directory's.

Per-probe absorption — an unreadable ancestor must not abort the scan — lives in exactly one place, `firstMatch`. The scan also **short-circuits**: later candidates are never probed. That is not just an optimization, because a marker predicate can be expensive (a workspace-root test reads and parses a `package.json`).

## The ascend ceiling fails closed

A `stopAt` ceiling is compared in **resolved form on both sides** and stays **inclusive**. Raw string equality was a **fail-open** bug: an unnormalized ceiling matched nothing, so the ascent ran to the filesystem root — the unbounded walk the option exists to prevent — with no error to notice it by. Both sides go through `resolve`, because normalizing only the ceiling desynchronizes it from an unnormalized chain element (`/a/b/.` names `/a/b`). Normalization is idempotent, so a caller that already resolves is unaffected, and it governs the **comparison only**: the chain returned is still the lexical one derived from the start, because rewriting it would break the lexical contract for every caller passing no ceiling at all.

A **relative** ceiling is a **defect**, not a typed failure, and is never resolved against `process.cwd()`. Two reasons, and the second is the load-bearing one:

- Resolving it would let the same ceiling name different directories in a lint-staged hook, a CLI run from a package directory and a test runner — the fail-open class again, through a different door.
- **Never "upgrade" this to a typed error.** [config-file](config-file.md)'s resolver contract absorbs every typed failure into `Option.none()`, so a typed rejection would be swallowed there and re-emerge as a clean-looking "no config found" — precisely the silent wrong answer the guard exists to close. `Effect.catch` does not catch defects, so only a defect survives that absorption, and a test reconstructs the absorbing caller to pin it.

Only the **ceiling** is constrained: a relative start still ascends to the relative root. Absoluteness is judged by the injected `Path`, so a win32 layer accepts `C:\repo`.

## The downward walk (descend)

The descent is a **worklist, not a recursion** — it cannot overflow the stack — dequeued by a head index rather than `Array.shift()`, which re-indexes the whole array on every dequeue and turns a large walk quadratic.

What earns a filesystem read is decided by the pattern's metadata. Four cases are worth recording because they are not obvious:

- **A literal pattern — no magic, not negated — never walks at all**: one stat decides.
- **A pattern that cannot match below one level never descends**, reading a single level instead.
- **A negated pattern walks from `cwd` and always deep-walks.** This is the subtle one. The enumeration prefix is computed from the *inner* pattern, but matching **inverts** — so a negated pattern matches everything the inner pattern does not, and its matches can land arbitrarily deep and *outside the prefix*. Both halves matter: the base must be the empty prefix, and the deep-walk condition must include the negated case, never segment-crossing alone. See [glob's note](glob.md#the-enumeration-metadata) that the enumeration prefix is meaningful for non-negated patterns only.
- **Patterns never escape `cwd`.** A pattern that lexically climbs above the root via `..` segments is zero matches, refused before any filesystem access — walked paths never contain `..`, so nothing such a pattern could match is ever produced, and a walker documented as rooted at `cwd` must not read or stat above it.

Zero matches is a **normal glob answer, not an error**: a missing literal path and a missing base directory both read as empty. Only files match — a symlink counts when it stat-resolves to a file, a dangling symlink does not, and a symlinked **directory is never descended** for cycle safety. A directory that vanishes between its parent's listing and its own read is a benign race and reads as empty in both unreadable-handling modes.

Output is sorted by cwd-relative POSIX path — an unsorted enumeration is a reproducibility hazard for every downstream consumer that hashes or diffs it.

## compileAndExpand — the recipe seam

`descend` answers "which files match this **compiled** pattern". `compileAndExpand` answers "which files match this pattern **source**", and exists because the seam between the two — compile, fold the compile error, expand, fold the descend error — was small enough that every consumer wrote it, and wrote it differently. One dogfood consumer wrote four differently-shaped error folds for one pattern inside a single package, and the fan-out produced a real bug: two divergent dotfile semantics with nothing making the divergence visible. That is the failure this module removes, and it is the same argument the [formatter convention](../formatter-convention.md#why-a-convention-and-not-four-local-answers) makes about unowned seams.

Three decisions carry the design:

- **The glob options are required, not optional.** Matching semantics — dotfile handling above all — are what two call sites most easily disagree about, and an optional field invites exactly the divergence above. Required means every call site states its dialect in its own source, so a disagreement is a visible difference between two spellings rather than the absence of one. Constructing the defaults explicitly is how a caller says "the defaults" deliberately.
- **One error, both causes intact.** The expansion error carries the underlying compile or descend error in `cause` rather than flattening it to a string, with a derived stage getter for callers that only need the phase. A caller catches one tag; a caller that needs the guard's limits or the descent's path still has them. `cause` is also the native `Error` cause, so chaining works unwired.
- **`FileSystem` and `Path` stay in `R`, deliberately** — even though hand-providing them is the friction this recipe otherwise removes. `FileSystem` *cannot* be provided: a library that picks its own filesystem cannot be tested against a fixture tree. Given that, providing `Path` internally saves the caller no layer and actively breaks win32, joining POSIX-style against a win32 filesystem.

Everything `descend` documents about traversal holds unchanged here, because this delegates to it.

## Wiring: services via R, not parameters

`Path` and `FileSystem` arrive via the `R` channel, never as function parameters. Two reasons make this the right seam:

- `Path.Path` is **branded**, so a structural `{ dirname, join }` duck type cannot satisfy it — the requirement can only be met by a real `Path` layer.
- `effect` core ships only a **POSIX** `Path.layer`. Whether traversal uses POSIX or win32 semantics is therefore chosen exactly once, by the consumer's platform layer at the edge.

## Error handling

**The two directions have deliberately opposite error postures.** Absorption is not a house style to apply uniformly — it is a claim about what a failed read *means*, and the meaning inverts with direction.

### Upward: every channel is `never`

- **Probe failures are absorbed per candidate, inside `firstMatch`.** A permission or broken-symlink failure on one candidate is caught and treated as "this candidate did not match", so the scan continues. Not-found and cannot-look are deliberately indistinguishable: discovery is best-effort, and a `None` may mean a directory was unreadable rather than empty.
- **Defects propagate.** `firstMatch` uses `Effect.catch`, which catches *failures*, not defects. A predicate that `throw`s is programmer error and must surface as a defect. The choice of `catch` over `catchCause` is load-bearing — a refactor to `catchCause` would quietly break this contract.
- **A non-positive-integer depth cap is a defect.** The guard tests `Number.isInteger` explicitly, not a bare `< 1`, which lets `NaN` and fractional values through. It can only come from code, so it dies.
- **A relative ceiling is a defect too**, per [the ceiling](#the-ascend-ceiling-fails-closed). Same line as the depth cap: malformed *input* fails typed, statically-wrong *wiring* dies.

Because the channel is `never`, the walking resolvers in config-file inherit their best-effort guarantee from walker's type rather than from wrapper prose.

### Downward: DescendError

`descend` fails typed, and **must not** inherit the upward absorption posture. The asymmetry is the point:

- Upward, an unreadable ancestor is one candidate that did not match; the scan can still succeed above it, and the answer stays correct.
- Downward, a swallowed subtree is **silently missing membership dressed as an empty result**. The caller cannot tell "no files matched" from "I could not look", and every consumer that acts on the answer — publishing, hashing, change detection — acts on a quietly wrong set.

So unreadable directories **fail** by default. A skip mode exists for callers who genuinely want best-effort, but it must be **asked for**, never assumed. Depth exhaustion is likewise a typed failure, never a truncation — silent truncation silently changes match semantics. An invalid depth cap stays a defect, exactly as upward.

`DescendError`'s reason field uses `Schema.Literals`, not `Schema.Literal`: the variadic `Literal` **silently ignores every argument after the first** in the pinned beta, so a two-argument `Literal` union quietly narrows to the first member.

## Hardening

The [hardening](../effect-standards.md#input-hardening-standards) discipline mostly does not apply — walker parses nothing and has no recursion over untrusted text. The traversal-specific invariants:

- **`ascend` is a bounded `for` loop, not recursion.** No stack-overflow surface. It terminates two ways: `Path.dirname` is a fixpoint at the root, and the depth cap guards a pathological `Path` implementation that never reaches one.
- **`ascend` is lexical, not physical.** `Path.dirname` does string manipulation and does not resolve symlinks, so ascending out of a symlinked directory follows the **given path**, not the real filesystem parent — correct for config discovery, where you want the config nearest the path the user named.
- **`firstMatch` stays interruptible.** The loop yields per candidate, so a long scan is cooperatively cancellable.
- **Candidates materialize up front**, bounded by the depth cap times the subpath count — a few hundred strings in practice. The slightly larger transient array buys the single-primitive factoring.

## Consumer relationship

Config-file's walking resolvers and xdg's config resolver build their candidate lists and hand them to walker's upward primitives, inheriting the `never` channel and per-candidate absorption from walker's type rather than from wrapper prose. Marker predicates `yield*` the `FileSystem`/`Path` services — `findRoot` is generic in `R` — so their error channel is typed rather than `unknown`. A predicate wrapping `JSON.parse` keeps its own `try`/`catch`: a parse throw is a defect, and `firstMatch` absorbs failures, not defects.

## Testing

Suites in `__test__/`, one per concept module, with the descend suite's in-memory trees factored into `fixtures.ts`.

Walker needs **no platform package, even for `descend`**: tests provide core's `Path.layer` (POSIX) plus a real in-memory volume from [`@effected/memfs`](memfs.md), a devDependency. A boundary package that does real IO can still be tested without a platform package when the IO surface is small enough.

That replaced a hand-rolled `FileSystem.layerNoop` tree which had to **re-derive the directory set from its file keys** and hand-model the two semantics `descend` actually reads — `stat` **follows** symlinks, `readLink` succeeds **only** on links. The volume owns both, so the path arithmetic is deleted rather than maintained; symlinks are seeded as entries. The unreadable-ancestor and vanished-directory cases are injected as `readDirectory` faults that decline for every other path, which is also how a permission failure is reached at all against a volume that records modes but never enforces them. A `layer(...)` boundary cannot vary per test, so each distinct tree gets its own block.

The invariants the suite pins, each watched failing against a deliberately broken implementation: per-candidate absorption; the `catch`-not-`catchCause` defect boundary; that an unreadable ancestor cannot hide a valid root above it; that the ceiling is inclusive and stops at the ancestor it *names* rather than the string it is spelled with; that a relative ceiling dies and survives the absorbing config-file caller reconstructed in the suite; and that nearer directories win.

## Build

`savvy.build.ts` carries the one narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` for the synthesized bases of the two error class factories. **Never widen it** — the pattern is scoped to `_base` precisely so a genuinely forgotten export still fails the gate.
