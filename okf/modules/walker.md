---
type: Module
title: walker
description: Path traversal as a small, testable library -- upward ascent to a marker via an absorbing search, and downward glob-file expansion with a fail-typed error posture, sharing no state and no error contract between the two directions.
status: stable
kind: package
resource: ../../packages/walker
layer: L1
tags:
  - architecture
sources:
  - id: walker-package-json
    resource: ../../packages/walker/package.json
  - id: walker-claude-md
    resource: ../../packages/walker/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-29T06:16:45Z
  body_sha256: 1ba613bb7d2f79897bf2e1e47e1fe55a57fc14c46430a47764437626686b2d80
---

# walker

## Scope and tier

`@effected/walker` is path traversal as a small, testable library, in two
directions. **Upward**: ascend a directory chain toward the filesystem
root and return the first candidate satisfying a predicate. **Downward**:
expand a compiled glob pattern under a directory and return the matching
files. A third module, `Expand.ts`, owns the compile-plus-expand recipe
over the downward walk.

The upward walk is the repository's **one absorbing traversal loop** —
[config-file](config-file.md), [xdg](xdg.md) and `@effected/workspaces`
all discover files through it.

**Boundary tier** — see [the library-tier glossary
entry](../glossary/library-tier.md). `peerDependencies` is `effect` and
`@effected/glob`; there are **no runtime dependencies**.[^walker-package-json]
`FileSystem` and `Path` arrive via the `R` channel from the consumer's
platform layer, so a win32-versus-POSIX choice is made exactly once, at
the consumer's edge. The `@effected/glob` edge is asymmetric across the
two modules: `descend` alone is type-and-property only — it imports
`GlobPattern` as a type and reads its metadata getters and `matches()` —
so a consumer importing only `descend` pulls no matching engine.
`compileAndExpand` value-imports glob's compiler, because owning the
compile step is the whole point of that module.

Walker defines no `Context.Service` of its own. Pattern-to-matcher stays
[glob](glob.md)'s job: walker is semantics-free about matching, reading
only the compiled pattern's metadata and calling `matches`. Downward
enumeration lives here because it had nowhere else to live — glob is a
pure matching engine with no walker, and "files matching a glob under a
directory" is the gap `descend` fills.

## Module layout

Two directions and one recipe: `Walker.ts` (upward), `Descend.ts`
(downward) and `Expand.ts` (the recipe), plus the re-export-only
`index.ts`.[^walker-claude-md] `descend` and `compileAndExpand` are bare
functions, not statics on the `Walker` class, because they are different
algorithms with a different error posture and folding either in would
imply they share `Walker`'s `never`-channel contract. `Walker` itself is
a static class with a private constructor, not an `as const` object, so
its `static readonly` declarations keep their TSDoc in the built
declaration file. A start directory is always required everywhere in the
package — walker never reads `process.cwd()`, because a traversal
library that silently defaults to the process working directory cannot
be tested or reasoned about.

## firstMatch is the whole algorithm

"Find the first candidate satisfying an absorbing predicate" **is** the
whole algorithm; everything else is candidate generation. `firstMatch` is
the single primitive, and the two named operations layer over it:
`findRoot` is a one-line specialization (candidates are the directories
themselves, the predicate is a marker test), and `findUpward` first
**flattens** each directory's candidates into one directory-major list
before handing that to `firstMatch` — the flattening is the ordering
invariant, since every candidate in the nearest directory is exhausted
before the scan ascends, so a distant ancestor's marker can never beat a
nearer directory's. Per-probe absorption lives in exactly one place,
`firstMatch`, and the scan short-circuits — later candidates are never
probed, which matters because a marker predicate can be expensive (a
workspace-root test reads and parses a `package.json`).

## The ascend ceiling fails closed

A `stopAt` ceiling is compared in **resolved form on both sides** and
stays **inclusive**. Raw string equality was a fail-open bug: an
unnormalized ceiling matched nothing, so the ascent ran to the filesystem
root — the unbounded walk the option exists to prevent — with no error
to notice it by. Both sides go through `resolve`, because normalizing
only the ceiling would desynchronize it from an unnormalized chain
element. Normalization governs the comparison only — the returned chain
stays the lexical one derived from the start.

A relative ceiling is a **defect**, not a typed failure, and is never
resolved against `process.cwd()` — see
[the ascend ceiling fails closed](../decisions/ascend-ceiling-fails-closed.md)
for the full reasoning. Only the ceiling is constrained: a relative start
still ascends to the relative root, and absoluteness is judged by the
injected `Path`, so a win32 layer accepts `C:\repo`.

## A physical ceiling is ascendWithin

`stopAt` is lexical, so it never matches a symlink-resolved ceiling —
`Git.repoRoot`'s answer is one — from a start reached through a symlink
(every macOS tmpdir), and the ascent runs to the filesystem root.
`Walker.ascendWithin(start, ceiling, options?)` is the physical form: the
same lexical chain, stopped at the nearest ancestor whose `realPath`
equals the ceiling's, inclusive. A ceiling the chain already spells costs
no I/O, a failed ancestor probe is absorbed as "not the ceiling", a
relative ceiling dies, and `Option.none()` is exactly `ascend(start)`.
It is a separate static taking an `Option`, not a mode of `stopAt`, so
`ascend`'s `R` stays `Path` alone — see [the physical-ceiling
Decision](../decisions/physical-ceiling-is-a-separate-static.md).

## The downward walk (descend)

A worklist, not a recursion — it cannot overflow the stack — dequeued by
a head index rather than `Array.shift()`, which re-indexes the whole
array on every dequeue. What earns a filesystem read is decided by the
pattern's metadata:

- A literal pattern — no magic, not negated — never walks at all: one
  stat decides.
- A pattern that cannot match below one level never descends, reading a
  single level instead.
- A negated pattern walks from `cwd` and always deep-walks: the
  enumeration prefix is computed from the inner pattern, but matching
  inverts, so its matches can land arbitrarily deep and outside the
  prefix.
- Patterns never escape `cwd` lexically: a pattern that climbs above the
  root via `..` segments is zero matches, refused before any filesystem
  access. Physically the walk stays under `cwd` only while `followSymlinks`
  is off — under it a link targeting outside `cwd` is descended, as
  `@actions/glob` follows links out of the tree.

Zero matches is a normal glob answer, not an error. Only files match — a
symlink counts when it stat-resolves to a file, a dangling symlink does
not, and a symlinked directory is never descended by default (cycle
safety). `followSymlinks: true` enters links under `@actions/glob`'s
per-branch `traversalChain` guard: each worklist frame carries its
branch's ancestor real paths, a directory whose real path is already an
ancestor of its own branch is a cycle and is skipped, and two sibling
links to one target both enumerate — the guard is never walk-global. Only
the base and each link pay a `realPath` (a plain directory's is its
parent's plus its name); a link whose `realPath` fails is never entered,
and that failure follows `onUnreadable` like a failed `readDirectory`, with
`NotFound` the silent benign race. `CacheKey.matchingFiles` in
`github-actions` opts in for runner `hashFiles()` parity.
Output is sorted by cwd-relative POSIX path, since an unsorted
enumeration is a reproducibility hazard for every downstream consumer
that hashes or diffs it.

## compileAndExpand — the recipe seam

`descend` answers "which files match this compiled pattern"; `Expand.ts`
answers "which files match this pattern source" — compile, fold the
compile error, expand, fold the descend error — a seam that was small
enough that every consumer wrote it, and wrote it differently, once
producing a real bug: two divergent dotfile semantics with nothing making
the divergence visible.

Three decisions carry the design: the glob options are **required, not
optional**, so every call site states its dialect in its own source
rather than inheriting a silent default; **one error, both causes
intact** — the expansion error carries the underlying compile or descend
error in `cause` rather than flattening it to a string, with a derived
stage getter; and `FileSystem` and `Path` stay in `R` deliberately, even
though hand-providing them is the friction this recipe otherwise removes
— `FileSystem` cannot be provided internally without breaking testability
against a fixture tree.

## Wiring: services via R, not parameters

`Path` and `FileSystem` arrive via the `R` channel, never as function
parameters, for two reasons: `Path.Path` is branded, so a structural
duck type cannot satisfy it, and `effect` core ships only a POSIX
`Path.layer` — whether traversal uses POSIX or win32 semantics is chosen
exactly once, by the consumer's platform layer at the edge.

## Errors

**The two directions have deliberately opposite error postures.**
Absorption is a claim about what a failed read *means*, and the meaning
inverts with direction.

- **Upward: every channel is `never`.** Probe failures are absorbed per
  candidate inside `firstMatch` — not-found and cannot-look are
  deliberately indistinguishable, since discovery is best-effort.
  Defects propagate (`firstMatch` uses `Effect.catch`, not `catchCause`).
  A non-positive-integer depth cap and a relative ceiling are both
  defects, never typed failures.
- **Downward: `DescendError`.** `descend` fails typed and must not
  inherit the upward absorption posture: a swallowed subtree downward is
  silently missing membership dressed as an empty result, and every
  consumer acting on it — publishing, hashing, change detection — acts
  on a quietly wrong set. Unreadable directories fail by default; a skip
  mode exists for callers who explicitly want best-effort, and a third
  mode, `onUnreadable: "record"`, resolves to `DescendResult { matches,
  unreadable }` carrying the absorbed `PlatformError` per unreadable
  directory. Depth exhaustion is a typed failure, never a silent
  truncation. `NotFound` mid-walk is never recorded — it is the same
  benign vanished-directory race in every mode.

## Hardening

Walker parses nothing and has no recursion over untrusted text.
`ascend` is a bounded `for` loop, not recursion, terminating at
`Path.dirname`'s fixpoint at the root, with the depth cap guarding a
pathological `Path` implementation. `ascend` is **lexical, not
physical** — `Path.dirname` does not resolve symlinks, so ascending out
of a symlinked directory follows the given path, which is correct for
config discovery; only `ascendWithin`'s stopping test touches the
filesystem, and never its chain. `firstMatch` stays interruptible, yielding per
candidate. Candidates materialize up front, bounded by the depth cap
times the subpath count.

## Consumer relationship

[config-file](config-file.md)'s walking resolvers and [xdg](xdg.md)'s
config resolver build their candidate lists and hand them to walker's
upward primitives, inheriting the `never` channel and per-candidate
absorption from walker's type rather than from wrapper prose. Marker
predicates `yield*` the `FileSystem`/`Path` services, so their error
channel is typed rather than `unknown`.

## Testing

Suites in `__test__/`, one per concept module, with the descend suite's
in-memory trees factored into `fixtures.ts`. Walker needs no platform
package, even for `descend` — tests provide core's `Path.layer` (POSIX)
plus a real in-memory volume from [`@effected/memfs`](memfs.md), a
devDependency; the volume owns the symlink-follow and readLink semantics
`descend` reads, so nothing is re-derived by hand. The unreadable-ancestor
and vanished-directory cases are injected as `readDirectory` faults that
decline for every other path.

Pinned invariants: per-candidate absorption; the `catch`-not-`catchCause`
defect boundary; that an unreadable ancestor cannot hide a valid root
above it; that the ceiling is inclusive and stops at the ancestor it
*names* rather than the string it is spelled with; that a relative
ceiling dies and survives the absorbing config-file caller reconstructed
in the suite; that `ascendWithin` stops at a physical ceiling reached
through a symlink and matches `ascend` under `Option.none()`; and that
nearer directories win.

## Build

`savvy.build.ts` carries the one narrow `{ messageId:
"ae-forgotten-export", pattern: "_base" }` suppression for the
synthesized base of the `DescendError` class factory. Gate on a
zero-warning `dist/prod/issues.json` via `pnpm build --filter
@effected/walker`.

[^walker-package-json]: `packages/walker/package.json` —
    `peerDependencies` lists `@effected/glob` and `effect`; no
    `dependencies` block.
[^walker-claude-md]: `packages/walker/CLAUDE.md` — the module layout and
    the `firstMatch` absorbing-loop design.
