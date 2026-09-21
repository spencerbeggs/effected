---
type: Interface
title: "@effected/workspaces snapshots"
description: WorkspaceSnapshots and WorkspaceStateSnapshot — point-in-time workspace reads at a git ref or in the worktree, with config-dependency hooks replayed at the ref's declared versions.
status: stable
kind: api
resource: ../../packages/workspaces/src/WorkspaceSnapshots.ts
tags:
  - architecture
sources:
  - id: workspace-snapshots-ts
    resource: ../../packages/workspaces/src/WorkspaceSnapshots.ts
  - id: workspace-state-snapshot-ts
    resource: ../../packages/workspaces/src/WorkspaceStateSnapshot.ts
  - id: change-detector-ts
    resource: ../../packages/workspaces/src/ChangeDetector.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-20T05:41:00Z
  body_sha256: 6eddd73a06883839c4b2bcb2477294abe7a93e1565da082e2c0296f55d79b870
---

# @effected/workspaces snapshots

`WorkspaceSnapshots` answers "what did this workspace look like at that
moment", at a git ref or in the worktree. `ChangeDetector` answers "what
changed between two points". Both run on `@effected/git`'s service over
core's spawner contract in `R`; requiring a core-declared service in `R`
costs a consumer nothing, which is why this package owns no subprocess seam
of its own.[^workspace-snapshots-ts][^change-detector-ts]

## WorkspaceSnapshots

`at(ref)` reads workspace state at a git ref with no checkout: package
directories come from `git ls-tree` matched against the compiled
`@effected/glob` set, and manifests are read through `git show`.[^workspace-snapshots-ts]
Every workspace-relative path handed to that read is `./`-prefixed so git
resolves it relative to the resolved workspace root rather than the git
repository's top level — a bare path would resolve at the repo top level,
so a workspace root nested inside a larger repository would read the outer
manifest and drop or misread its members.

Reading at a ref requires no checkout, and four properties are
load-bearing: workspace globs fall back to the root manifest's field when
the pnpm workspace file is absent at that ref, because without it a bun or
npm workspace collapses to the root package alone and a diff reads every
dependency as newly added with no error; package directories come from the
compiled glob set matched against tree entries, never a live directory
descent; a path absent at the ref is skipped, never an error; and the root
manifest's inline bun catalogs are read unconditionally, not gated on a bun
lockfile's presence, since gating them would reintroduce the same
"everything looks added" bug for a bun repository with inline catalogs but
a not-yet-committed lockfile.

Results cache per `(resolved root, ref)`, invalidated on any non-success
exit rather than memoized unconditionally. The composite cache key is
NUL-separated, since a NUL can appear in neither a path nor a ref, and it
is written as the escape sequence rather than a literal NUL byte, because a
literal one makes `file` classify the module as binary and grep silently
skip it. `worktree()` reads the live tree over the one shared
`WorkspaceDiscovery` plus `WorkspaceCatalogs` path — there is no second
manifest or lockfile read for the worktree.

## Hook replay at a ref

Reading at a ref replays the ref's own `configDependencies` — read from
that ref's `pnpm-workspace.yaml`, seeded by that ref's inline catalogs and
peer-dependency rules — through whichever `ConfigDependencyHooks` layer is
in scope, and merges the injection above the ref's lockfile and inline
sources exactly as the live assembler does.[^workspace-snapshots-ts] The
service therefore requires that layer, and the composites hand one
reference to it and to `WorkspaceCatalogs` so the two sides of a diff run
one policy. Under the no-op layer nothing executes and the ref side sees
no hook-injected catalog; under a replaying layer each ref's hook runs at
the version that ref declares — resolved through the installed copy or the
pnpm store by the live and subprocess layers, failing closed otherwise, or
taken from a caller-supplied `"<name>@<version>"` map under
`ConfigDependencyHooks.layerFrom` via `Workspaces.layerWithGitAndHooks` (see
[the config-dependency seam](workspaces-catalogs.md#the-replaying-layers-resolve-the-declared-version)),
which still requires no checkout, no fetch and no historical code the
machine has not already installed. Every snapshot records which version
each config dependency was replayed from in `hookReplays`, a `name →
version` record set on every fresh read (empty under the no-op layer or
where config dependencies do not exist) and absent only on values
serialized before the field existed; the resolution rung is machine-local
provenance that stays on the live injection, and the worktree read takes
the record off the same memoized assembly as the catalog set.

The importer-version fallback remains for the no-op case: when the catalog
set cannot answer a `catalog:` specifier, resolution falls back to the
version that ref's own lockfile importer entry recorded. Warning and
emitting no row was rejected, since it leaves the resulting changeset
missing.

### The seeded-catalog seam

The importer-version fallback answers with a concrete version, which is
enough to make a specifier resolve but not enough to see a range move: two
refs that installed the same version report the same string, so a real
bump of a hook-injected catalog's declared range produces no diff row.
`WorkspaceStateSnapshot`[^workspace-state-snapshot-ts] therefore carries `seededCatalogs`, a set supplied
by the caller and consulted strictly below the snapshot's own catalogs, so
the resolution chain reads: this moment's own catalogs, then the seed (a
range), then the importer-version fallback (a version). Nothing is
replayed and nothing is fetched — the consumer already holds a live set,
paid for by choosing a config-dependency layer, and simply hands it to the
ref side.

The seed is its own field, never merged into `catalogs`, because `catalogs`
means "the set assembled at this moment" and a snapshot is a serializable
value consumers store and diff; blending an external set into it would
silently redefine the field with nothing downstream able to tell the
halves apart. The seed's lower precedence is what makes seeding safe to do
unconditionally, since a seed can only ever add an answer where there was
none.

`WorkspaceStateSnapshot.crossSeed(before, after)` gives each side the
other's catalogs. `withSeededCatalogs` replaces an existing seed rather
than accumulating it, because an accumulating seed would make precedence
depend on call order — but the layer-level `seedCatalogs` option puts a
seed on every snapshot the service returns, so a `crossSeed` built on a
bare replace would silently discard that seed on both sides at once,
reopening the hook-catalog gap. `crossSeed` therefore composes the two
explicitly: the other ref's committed catalogs win, and the carried seed
answers only what neither ref declared. Under a replaying hooks layer a
range change made purely by bumping the config dependency between two
refs is detected — each ref's own catalogs carry its replayed range, so the
seed never gets a say; under the no-op layer that case stays suppressed,
because neither committed source declares the catalog, and the only
committed evidence is `configDependencies` in `pnpm-workspace.yaml`, which
a consumer diffs directly (see
[the cross-ref bump limitation](../limitations/workspaces-snapshot-hook-catalog-bump-between-refs.md)).
Both cases are pinned by tests.

## Importer versions

The join is by dependency name across every field, because pnpm writes a
peer into the importer block only when it is also installed, so a peer's
concrete version can sit on a different row than expected. Recorded
versions must be normalized, because `@effected/lockfiles` stores the
importer version verbatim including pnpm's peer suffix, which unstripped
renders the whole parenthesized chain as a version.

Workspace-wide resolution answers only when every importer recording that
dependency agrees — divergence is `Option.none()`, never a guess. The
importer-scoped form is the precise variant for callers holding a package's
relative path.

## Change detection

`ChangeDetector` computes a committed range and optionally folds in
working-tree changes, with a non-repository surfacing as git's own typed
error alongside this package's own error union. A test provides
`@effected/git`'s own shipped double, whose unstubbed members die named,
and needs no repository on disk.

[^workspace-snapshots-ts]: `packages/workspaces/src/WorkspaceSnapshots.ts` —
    `WorkspaceSnapshots`, `at(ref)` / `worktree()`, and its two failure
    unions.
[^workspace-state-snapshot-ts]: `packages/workspaces/src/WorkspaceStateSnapshot.ts` —
    `WorkspaceStateSnapshot`, `PackageStateSnapshot`.
[^change-detector-ts]: `packages/workspaces/src/ChangeDetector.ts` —
    `ChangeDetector`, `ChangeDetectionOptions`, `ChangeDetectionError`,
    `ChangeDetectionFailure`.
