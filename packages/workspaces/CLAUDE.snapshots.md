# Snapshots and change detection — @effected/workspaces

`WorkspaceSnapshots`, `WorkspaceStateSnapshot` and `ChangeDetector` — the at-ref and working-tree reads that run on `@effected/git`.

**Parent:** [@effected/workspaces context](./CLAUDE.md)

## `WorkspaceSnapshots` — "what did this workspace look like then"

`at(ref)` reads workspace state at a git ref with **no checkout**, entirely over `Git`: package dirs come from `Git.lsTree` matched against the compiled `@effected/glob` set (no directory descent), manifests via `Git.show`.

Every workspace-relative path handed to `Git.show` is **`./`-prefixed** (the manifest, the `pnpm-workspace.yaml`, each member `./<dir>/package.json`, and the lockfile) so git resolves it relative to `cwd` — the resolved workspace root — aligning with `Git.lsTree`, which already emits cwd-relative paths. A **bare** path resolves relative to the git repo TOP-LEVEL, so a workspace root nested inside a larger repo would read the OUTER manifest and drop or misread its members; `__test__/integration/WorkspaceSnapshotsNested.int.test.ts` is the nested-repo regression guard. `Git.show`'s contract is unchanged — the `./` is this reader's explicit choice, not a service change.

When `pnpm-workspace.yaml` is absent at the ref, patterns and catalogs fall back to the root `package.json` `workspaces` field (c594ff1) — without it a bun/npm workspace collapses to the root package alone and a diff reads every dependency as newly added.

Results cache per `(resolved root, ref)` via `Effect.cachedInvalidateWithTTL` at `Duration.infinity`, invalidated on any non-success exit (never bare `Effect.cached`). The two are joined by a **NUL** (neither a path nor a ref can contain one, so keys cannot collide) written as the `\0` **escape** — a literal NUL byte makes `file` classify the source as binary and grep/ripgrep skip the whole module silently (#187).

`worktree()` reads the live tree over the **one shared** `WorkspaceDiscovery` + `WorkspaceCatalogs` path — no second read.

## `WorkspaceStateSnapshot`

A serializable value (`packages`, `catalogs`, `importerVersions`) with lazy `#private` indexes: `versions`, `package(name)`, `resolve(dependency, specifier)` (classified through `@effected/npm`'s `DependencySpecifier`, never prefix-sniffed), `resolveIn(importerPath, dependency, specifier)`, and the snapshot-scoped `catalogResolver` / `workspaceResolver` / `resolvers` layers answering `@effected/npm`'s contracts as of that snapshot. `PackageStateSnapshot` is the narrower per-member slice.

Failure unions: `WorkspaceSnapshotAtFailure` (git errors + `CatalogAssemblyError` from the inline source + `WorkspaceRootNotFoundError`; a malformed *lockfile* at the ref degrades to no catalogs) and `WorkspaceSnapshotWorktreeFailure` (never touches git).

`resolve` is workspace-wide and has no importer context, so it answers only when **every** importer recording that dependency agrees; divergence yields `Option.none()` rather than a wrong answer. `resolveIn(importerPath, …)` is the precise form when the caller knows the importer (`PackageStateSnapshot.relativePath`, `"."` for root).

A `catalog:` specifier resolves in **three** steps and the order is the contract: this moment's own `catalogs`, then `seededCatalogs`, then the importer-version fallback. The first two answer with a declared RANGE, the third with a concrete version — which is why a seeded snapshot reports a range change where an unseeded one can only report a version, and why an unseeded pair of refs that installed the same version yields no diff row. Why a hook replay must never be used instead is in [catalogs](./CLAUDE.catalogs.md).

`seededCatalogs` is catalogs supplied from OUTSIDE the moment — the live hook-injected set, or the other side of a diff. **Never merge it into `catalogs`**: that field means "the set assembled at this moment", a snapshot is a value consumers store and diff, and blending would redefine it with nothing able to tell the halves apart. Its LOWER precedence is what makes seeding safe unconditionally — a seed can only add an answer where there was none, so an over-broad seed cannot corrupt a diff. `withSeededCatalogs(seed)` returns a new snapshot and REPLACES any existing seed (merging would make precedence depend on call order); `WorkspaceStateSnapshot.crossSeed(before, after)` is the two-ref form; `WorkspaceSnapshotsOptions.seedCatalogs` is the layer-level spelling, applied to `at(ref)` **and** `worktree()` so the two sides of a diff cannot drift on whether they seed.

**The cross-seed limitation is intended and pinned by a test** — a range change made purely by bumping the config dependency between refs stays suppressed, because neither committed source declares the catalog. Do not "fix" it; diff `configDependencies` in `pnpm-workspace.yaml`, the only committed evidence.

## Change detection runs on `@effected/git`

`GitReader` is **gone** — the module and its local `GitCommandError` were deleted. `ChangeDetector` runs on `@effected/git`'s `Git` service: `changedFiles(root, { base, head, relative: true })` for the committed range, `workingChanges(root, { relative: true })` for `includeUncommitted`, unioned and sorted.

Every query uses `relative: true` so paths come back relative to the workspace root — correct even when the workspace is nested inside a larger git repository. A non-repository surfaces as git's own `NotARepositoryError` (not re-wrapped); `ChangeDetectionFailure` carries git's typed errors alongside `ChangeDetectionError` and the discovery failures.

`Git` requires core's `ChildProcessSpawner` in `R`, discharged by the consumer's platform layer at the edge. A test provides `Git.layerTest({ … })` — git's own shipped double, whose unstubbed members die named — and needs no repository on disk; hand-enumerating the whole `GitShape` breaks on every growth of that service.

**Related:** [surface](./CLAUDE.surface.md) · [discovery](./CLAUDE.discovery.md) · [catalogs](./CLAUDE.catalogs.md) · [peers](./CLAUDE.peers.md)
