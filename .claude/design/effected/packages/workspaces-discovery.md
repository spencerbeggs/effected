---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - workspaces.md
  - workspaces-graph.md
  - workspaces-catalogs.md
  - workspaces-snapshots.md
  - glob.md
  - walker.md
  - package-json.md
  - memfs.md
---

# @effected/workspaces — discovery and detection

## Overview

Discovery is the half of [@effected/workspaces](workspaces.md) that answers *where is the workspace, what is in it, and which package manager runs it*: root finding, the `packages:` enumerator and its traversal, the located-member model, and package-manager detection. Everything else in the package — [the dependency graph](workspaces-graph.md), [catalogs](workspaces-catalogs.md), [peer checking](workspaces-peer-check.md), [snapshots](workspaces-snapshots.md) and [the release surface](workspaces-release.md) — reads its answers.

The services live in `src/WorkspaceRoot.ts`, `src/WorkspaceDiscovery.ts` and `src/PackageManagerName.ts`, each with its layer in the same file; the located-member model is `src/WorkspacePackage.ts`.

## The packages: enumerator

`src/internal/enumerate.ts` compiles the `packages:` list once and enumerates the workspace, fixing a class of degradation where a trailing globstar silently collapses to a single-level wildcard so a nested package goes undiscovered with no diagnostic. [Glob](glob.md)'s compiled-set metadata exists specifically for this enumerator.

1. Compile the list once, with default options — **there is no options surface to diverge on**.
2. **Literals** fast-path to an exact manifest existence check.
3. **Wildcards** read from the compiled enumeration prefix: a single-level read when the pattern cannot cross segments, and a **bounded iterative descent** from that prefix when it can, testing each visited directory's root-relative POSIX path against the pattern.
4. **Excludes** drop candidates after positive matching.
5. A directory counts as a workspace package only if it holds a manifest.

The descent is a **worklist, not a recursion**, so it cannot overflow the stack. It is bounded three ways: a depth cap that is integer-guarded so `NaN` and fractions die rather than silently enumerating nothing, a visited-directory budget, and unconditional pruning of `node_modules` and `.git`. A wildcard whose prefix names a nonexistent directory fails typed.

**Core's filesystem glob overlaps the traversal half and has not displaced it.** The matcher half stays [@effected/glob](glob.md), which core does not duplicate. Whether core's traversal honours the semantics this enumerator guarantees — the bounded descent, the prune list, the integer-guarded depth cap, the typed failure at a bound and the one-state-machine discipline shared with the sync entry point — needs a behavioral probe before any replacement, so the enumerator stays. Core's filesystem watch stream is where any future watch-mode discovery would build.

### One traversal, two entry points

`src/internal/traverse.ts` owns the worklist, the dequeue discipline, the depth rule, the visit budget and the prune list. Both the Effect enumerator and [the sync escape hatch](workspaces.md#workspacessync--the-escape-hatch) drive it, and **neither re-decides any of those**.

The dequeue uses a **head index, never `Array.shift()`** — `shift()` re-indexes the array on every dequeue, so draining a near-budget worklist is quadratic. **The depth cap bounds what is enumerated, not merely what is descended into.**

The one deliberate divergence between the two entry points is what happens at a bound: the Effect path fails typed, the sync path truncates because it has no error channel. A test drives **both** entry points against one real tree at the boundary, because the sync copy once accepted a child before checking its depth and returned a package one level beyond the cap the Effect enumerator rejected.

## WorkspacePackage

A `Schema.Class` carrying a located workspace member. It keeps a **tolerant** manifest projection rather than embedding [package-json](package-json.md)'s strict `Package`, because that model requires a valid name and a parseable semver version — so **one member with a non-semver version would fail discovery for the whole repo**. The strict model is one method away, which makes the two different entities rather than duplicates: a located member that was *discovered*, versus a fully-typed manifest that was *decoded*.

**The as-read manifest record is captured at discovery**, so a consumer needing a field outside the typed slice reads it without a second file read or a strict decode that can fail on odd manifests. Values are unvalidated beyond being a record. Two decisions around it are deliberate: **the re-reading manifest method stays**, because its point-in-time refresh semantics depend on re-reading, which a captured record cannot provide; and **the snapshot type is not widened to carry it**, because [the snapshot](workspaces-snapshots.md) remains the narrow store-and-diff value and bloating every stored snapshot with full manifests would tax the store for a field diffing never reads.

Dependency-pattern matching takes a compiled pattern or a string. Passing a compiled pattern is total and free; **an uncompilable string literal is a defect**, because a glob written into a call site is developer wiring rather than untrusted input. Compile once and reuse in a loop.

## Root finding and discovery

**Root finding runs over [@effected/walker](walker.md)**, inheriting per-probe error absorption. Markers, in priority order: the pnpm workspace file, then a manifest with a workspaces field.

**Discovery** reads the packages list from whichever source the workspace uses, enumerates it, reads each manifest, and absorbs the longest-prefix file-to-package lookup.

**Discovery is bound to one root, and `listPackagesIn` / `infoIn` are the escape from that** — not a convenience. A long-lived host (an MCP server, a language server) resolves its root once at startup and then serves calls scoped to a git worktree of the same repository, a nested repository, or another project entirely; the layer-bound methods answer about the startup root and cannot vary per call without building a fresh layer. These two take a directory, resolve ITS root by the same upward walk, and **re-read everything beneath it**.

**The re-read is the point, and the cheap alternative is the trap.** Re-rooting the layer's existing package list — rewriting each `path` onto the caller's directory — produces correct-looking paths over the ORIGINAL root's manifests, so a worktree whose branch adds, removes or renames a package reports the other branch's membership with no error at all. Names and versions are wrong in exactly the same silent way. A downstream consumer shipped that workaround and documented the limitation; these methods exist to lift it. The test fixture accordingly holds two workspaces that DISAGREE on both membership and versions, because a fixture whose roots agree cannot tell the two implementations apart.

Memoization is per RESOLVED root, so many directories inside one workspace share one discovery, and the map is deliberately separate from the layer-bound memo — folding them together would make every layer-bound call re-run the root ascent. It grows one entry per distinct root, which is the intended behavior for a host serving many worktrees.

**Invalidation comes in both grains, and the fine one is not a convenience.** `refresh()` clears every per-root memo plus the layer-bound one; `refreshIn(directory)` drops exactly one, because a host refreshing the worktree that changed should not discard the siblings that did not — which is all the coarse form can do. `refreshIn` invalidates the cell **before** dropping the map reference: a fiber already holding that memo keeps its own reference, so leaving the cached value live would let it replay a discovery this call was asked to discard. It fails typed on a directory in no workspace, matching the two reads rather than absorbing — the three per-root methods answer a bad path identically, and a caller wanting a no-op writes `Effect.ignore`. Refreshing a root that has no memo is an ordinary no-op.

**No eviction policy, deliberately.** The consuming host's roots are unbounded in principle but single-digit in practice, and its refresh-before-inspect discipline means the memo amortizes within one inspection burst rather than across process lifetime. A policy invented without that shape would have been a guess; the question was asked and answered before the surface shipped.

### Ambient cwd is an explicit option

Root resolution is one concern, applied uniformly: every root-consuming layer takes an optional cwd, defaulting to the ambient one read **lazily at first use**, inside a suspend, so a directory change between provide and first call is honoured. **No service method reaches for the ambient cwd.** A parameterized layer factory mints a fresh reference per call — bind it to a `const` once.

## Package-manager detection

**Lockfile evidence is the primary signal** — it is what says which manager actually ran. The workspace tier checks the pnpm workspace file, then a bun lockfile *plus* a manifest field naming bun, then a yarn lockfile *plus* a manifest field naming yarn, then a workspaces field for npm. **The manifest conjunction on bun and yarn disambiguates a stray lockfile** in an npm repo.

This package's manager literal is its own. It is structurally identical to [lockfiles](lockfiles.md)' format literal and assigns freely to it, but they are **different concepts sharing a carrier**, and the name avoids colliding with [package-json](package-json.md)'s corepack class in a consumer's import list.

### The standalone and declaration tiers

Those markers answer "which manager runs this **workspace**", and most repos are not workspaces. A single-package repo was once undetectable, which is why one consumer carried *three* competing hand-rolled detections with two different silent defaults. Two tiers close it:

- **Standalone** — a pnpm or npm lockfile stands alone, because each is written by exactly one manager; bun and yarn keep the manifest conjunction. The conjunctions **mirror the workspace tier exactly** rather than inventing a looser second rule inside one service.
- **Declaration** — no lockfile at all, but a manifest field names one of the four. A fresh clone before its first install has no lockfile to read and its manifest still says plainly what is meant to run. Weaker evidence, so it is consulted last.

**Both tiers run after every workspace marker has missed, which makes the widening strictly additive**: no input that already resolved can change its answer, and a stray npm lockfile cannot turn a pnpm workspace into an npm repo. A regression test pins that ordering, because reordering the tiers is the obvious and wrong "simplification".

**The detector refuses to guess.** Nothing matching is a typed error, never a fabricated default — and the proof that this is the right contract is that the two consumer reimplementations both invented a default here and invented *different* ones. **Choosing one is policy, not detection**, and a library that makes the choice silently guarantees some caller is wrong. A consumer wanting a default writes the fallback where a reader can see it. The error names everything it tried.

**Known asymmetry, deliberately unchanged:** within the workspace tier the npm workspaces field is still consulted *before* any standalone lockfile, so a repo with both reports npm. Reordering so lockfile evidence outranks the field would be a behavior change to an already-shipped path rather than an additive one; it is recorded here rather than made silently.

### The two fields that declare a manager

Corepack reads **both** the top-level manifest field and the dev-engines one, and they are not interchangeable — the second is a validation and fallback layer over the first, and corepack errors when they disagree. The detector implements:

- **The dev-engines name is authoritative for the NAME.** Where both are present and disagree, it wins, and the top-level field's name is not consulted as a disambiguator.
- **The top-level field is authoritative for the exact VERSION**, because it carries the integrity hash. Where both name the same manager its version wins; where it is absent, the dev-engines version supplies one.
- **A version is reported only when the field it came from names the manager actually detected.** A field naming a different manager says nothing about the detected one's version.

Both fields' versions normalize through [package-json](package-json.md)'s corepack codec, so a version carrying a hash reports the same version either field would. **A range yields no version** — a range is not a version, and corepack will not run one.

**A malformed manifest hint is ignored, never fatal**: it cannot turn a detectable workspace into a detection failure. A manifest that is *present but unreadable or unparseable* is different and fails typed, because a corrupt root manifest is a real problem rather than a missing hint.

## Test doubles

All three services ship `makeTest` / `layerTest` doubles, so **the whole discovery path stands up with no filesystem at all**. The defaults model an empty workspace, and derived methods run over the *effective* package list, so stubbing only the enumeration yields a consistent double.

**Both per-root methods die unstubbed.** Deriving `listPackagesIn` from `listPackages` would model a world in which every root holds the same members — precisely the confusion the method exists to remove — so a double that fabricated it could not discriminate a consumer calling the wrong one.

**Two more members deliberately die as defects rather than returning a default**: workspace info, because no honest default exists and a fabricated root path would leak into consumer path logic; and detection, where the reasoning is sharper — **a double that answered with a manager would contradict the defining property of the service it stands in for**, which is that the live detector refuses to guess. Failing typed would be the subtler mistake, because a detection error reads as a legitimate "no manager here" answer that a consumer branches on and proceeds past, never learning the test simply forgot to stub. Both wrong shapes are mutation-pinned.

The edges worth preserving if the suites are rewritten: matches landing on the first and the last candidate, a globstar target **two** levels down (the collapse regression), a depth-cap case, a prune case, an exclusion that must actually exclude, and the two-entry-point traversal drift driven against one real tree at the depth boundary.
