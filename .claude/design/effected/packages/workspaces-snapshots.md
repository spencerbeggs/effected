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
  - workspaces-catalogs.md
  - workspaces-discovery.md
  - git.md
  - npm.md
  - glob.md
---

# @effected/workspaces — git integration and snapshots

## Overview

The git half of [@effected/workspaces](workspaces.md) answers two questions the workspace model alone cannot: *what changed between these two points*, and *what did this workspace look like at that ref*. Change detection lives in `src/ChangeDetector.ts`; the snapshot service and its value class are `src/WorkspaceSnapshots.ts` and `src/WorkspaceStateSnapshot.ts`.

Both run on [@effected/git](git.md)'s service over core's spawner contract in `R`. **Requiring a core-declared service in `R` costs a consumer nothing (R3), which is why this package owns no subprocess seam of its own.** A test provides git's own shipped double, whose unstubbed members die named, and needs no git repository on disk — hand-enumerating the whole git shape is a maintenance liability that every growth of that service breaks.

**Change detection** computes a committed range and optionally folds in working-tree changes, with a non-repository surfacing as git's typed error alongside this package's own.

## WorkspaceSnapshots

Snapshots answer "what did this workspace look like at that moment", at a ref or in the worktree. The snapshot value class carries the package list, the catalog set and an importer-version index, with lazily-built instance-cached private indexes **outside** the schema — the [`DependencyGraph`](workspaces-graph.md) precedent. **It is serializable by construction.**

Its resolve method answers "what did this specifier mean HERE", against this snapshot's own package versions and catalog set, classifying specifiers through [npm](npm.md)'s vocabulary. Beyond that, **a snapshot hands back layers implementing npm's resolver contracts against itself**, so anything written to the contracts can run "as of" a ref.

**Reading at a ref requires no checkout.** Four properties are load-bearing:

- **Workspace globs fall back to the root manifest's field when the pnpm file is absent at that ref.** Without this a bun or npm workspace collapses to the root package alone, and a consumer diffing two snapshots sees every declared dependency as newly added, with no error. Named regression test.
- **Package directories come from the compiled glob set matched against tree entries**, which is the at-ref discovery [glob.md](glob.md) records.
- **A path absent at the ref is skipped, never an error.**
- **The root manifest's inline bun catalogs are read unconditionally**, not gated on a bun lockfile's presence — gating them reintroduces the "every dependency looks added" bug for a bun repo with inline catalogs but a not-yet-committed lockfile. Parity-tested against the worktree read.

**The worktree read is the one shared read path** between worktree snapshots and [catalog assembly](workspaces-catalogs.md); there is no second manifest or lockfile read for the worktree.

Caching is per root-and-ref with invalidate-on-non-success. The composite key is **NUL-separated**, since a NUL can appear in neither a path nor a ref so the key cannot collide — and it is spelled as the **escape** rather than a literal NUL byte, because a literal one makes `file` classify the module as binary and grep silently skip it. A source file that grep reports as absent is a maintenance hazard out of all proportion to the byte. The two error unions stay narrow, and each excludes what its path never does: the at-ref one never enumerates the live filesystem, and the worktree one never invokes git.

## The at/worktree hook-catalog asymmetry

**Reading at a ref never replays config-dependency hooks** — it reads inline catalogs plus the lockfile at that ref only. So under the hook-replaying layer, an at-ref snapshot and a worktree snapshot can disagree on hook-injected *catalog sets*. **This is deliberate: an at-ref read must not execute historical config-dependency code.**

**The importer-version fallback closes the gap for resolution** without touching that asymmetry. A hook-injected catalog is recorded in no committed catalog source, so a peer declared against such a catalog resolved to nothing on *both* sides of a diff and a real version bump produced no row and no changeset. When the catalog set cannot answer a catalog specifier, resolution falls back to the version that ref's **own lockfile importer entry** recorded.

The rejected alternatives matter more than the accepted one:

- **Rejected — replay the ref's pinned config dependency.** Network fetch plus arbitrary historical code execution per ref, and impossible for an at-ref read regardless, since it reads without a checkout. Switching the default to the hook-replaying layer fixes only the worktree side and manufactures a bogus specifier-to-version row on every run.
- **Rejected — warn and emit no row.** Leaves the changeset missing, which is the reported defect.
- **Accepted — the lockfile importer fallback.** Both lockfiles are committed, so both read paths answer identically with no hook replay and no network. Scoped to catalog specifiers only; a plain range is already its own answer.

### The seeded-catalog seam

**The seeded-catalog seam closes the remaining half, and it is a FOURTH option rather than a reversal of the two rejected above.** The importer-version fallback answers with a concrete *version*, which is enough to make a specifier resolve but not enough to see a **range** move: two refs that installed the same version report the same string, so a real bump of a hook-injected catalog's declared range produces no diff row. `WorkspaceStateSnapshot` therefore carries `seededCatalogs`, a set supplied by the CALLER and consulted strictly below the snapshot's own catalogs, with the whole chain reading: this moment's own catalogs, then the seed (a range), then the importer-version fallback (a version).

Why this does not reopen what was rejected: **nothing is replayed and nothing is fetched.** The consumer already holds a live set — it paid for it by choosing a config-dependency layer — and simply hands it to the ref side. `at(ref)` still executes no historical code, which was the entire content of the first rejection.

Two shape decisions carry the weight:

- **The seed is its own field, never merged into `catalogs`.** `catalogs` means "the set assembled at this moment", and a snapshot is a serializable value consumers store and diff; blending an external set into it would silently redefine the field with nothing downstream able to tell the halves apart. Kept separate, the ref's own declaration always wins and both remain readable. This is a deliberate deviation from the literal downstream ask, which proposed merging.
- **Lower precedence is what makes seeding safe to do unconditionally.** A seed can only ever ADD an answer where there was none, so an over-broad seed cannot corrupt a diff, and a genuine range change between two refs that both declare the catalog still reads as a change.

`WorkspaceStateSnapshot.crossSeed(before, after)` gives each side the other's catalogs — the two-ref symmetry — and `WorkspaceSnapshotsOptions.seedCatalogs` is the layer-level spelling, applied to `at(ref)` and `worktree()` alike so the two sides of a diff cannot drift on whether they seed.

**The two seeding surfaces compose, and making them compose took a deliberate exception.** `withSeededCatalogs` REPLACES an existing seed, because an accumulating seed would make precedence depend on call order. But the layer-level option puts a seed on *every* snapshot the service returns, so a `crossSeed` built on a bare replace discarded that seed on **both** sides at once — silently reopening the exact hook-catalog gap the feature closes, with no error and no warning. `crossSeed` therefore composes the two explicitly: the other ref's committed catalogs win (that is what cross-seeding is *for*), and the carried seed is kept beneath them to answer what neither ref declared. Caught in review, not by the suite, which is why both the interaction and its precedence have their own tests. **The inherent limitation is documented and pinned by a test rather than worked around**: a range change made purely by bumping the config dependency BETWEEN two refs stays suppressed, because neither committed source declares the catalog and each side then falls back to the other's value. The only committed evidence of that case is `configDependencies` in `pnpm-workspace.yaml`, which a consumer diffs directly.

## Importer versions

Two properties are load-bearing and easy to break: **the join is by dependency name across every field**, because pnpm writes a peer into the importer block only when it is also installed, so a peer's concrete version can sit on a different row than expected; and **recorded versions must be normalized**, because [lockfiles](lockfiles.md) stores the importer version verbatim including pnpm's peer suffix, which unstripped renders the whole parenthesized chain as a version.

**Workspace-wide resolution answers only when every importer recording that dependency agrees** — divergence is `None`, never a guess. The importer-scoped form is the precise variant for callers holding a package's relative path, and the live index comes off the **same** memoized read, keeping the one-shared-read-path rule intact.

## Test edges

**A bun or npm workspace read at a ref must not collapse to the root package alone**, and the two read paths must agree on a clean tree — which also pins the unconditional inline-catalog read. **TTL-cache discipline**: a failed at-ref init is retried, not memoized.
