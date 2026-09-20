# Snapshots and change detection — @effected/workspaces

`WorkspaceSnapshots`, `WorkspaceStateSnapshot` and `ChangeDetector` — the at-ref and working-tree reads that run on `@effected/git`.

**Parent:** [@effected/workspaces context](./CLAUDE.md)

## `WorkspaceSnapshots` — "what did this workspace look like then"

`at(ref)` reads workspace state at a git ref with **no checkout**, entirely over `Git`: package dirs come from `Git.lsTree` matched against the compiled `@effected/glob` set (no directory descent), manifests via `Git.show`.

Every workspace-relative path handed to `Git.show` is **`./`-prefixed** (the manifest, the `pnpm-workspace.yaml`, each member `./<dir>/package.json`, and the lockfile) so git resolves it relative to `cwd` — the resolved workspace root — aligning with `Git.lsTree`, which already emits cwd-relative paths. A **bare** path resolves relative to the git repo TOP-LEVEL, so a workspace root nested inside a larger repo would read the OUTER manifest and drop or misread its members; `__test__/integration/WorkspaceSnapshotsNested.int.test.ts` is the nested-repo regression guard. `Git.show`'s contract is unchanged — the `./` is this reader's explicit choice, not a service change.

When `pnpm-workspace.yaml` is absent at the ref, patterns and catalogs fall back to the root `package.json` `workspaces` field (c594ff1) — without it a bun/npm workspace collapses to the root package alone and a diff reads every dependency as newly added.

Results cache per `(resolved root, ref)` via `Effect.cachedInvalidateWithTTL` at `Duration.infinity`, invalidated on any non-success exit (never bare `Effect.cached`). The two are joined by a **NUL** (neither a path nor a ref can contain one, so keys cannot collide) written as the `\0` **escape** — a literal NUL byte makes `file` classify the source as binary and grep/ripgrep skip the whole module silently (#187).

`at(ref)`'s pnpm branch replays the ref's `configDependencies` (from the ref's own `pnpm-workspace.yaml`, via the shared readers in `internal/workspaceYaml.ts`) through the `ConfigDependencyHooks` layer in `R`, seeded by the ref's inline catalogs and rules, and merges the injection at the live assembler's precedence (`lockfile → inline → injected`). A replaying layer resolves each declared version through `.pnpm-config` or the pnpm store ([catalogs](./CLAUDE.catalogs.md)), so two refs declaring different config-dependency versions replay two different pnpmfiles; `layerNoop` returns the seed and executes nothing. `WorkspaceSnapshots.make`/`layer` therefore require `ConfigDependencyHooks`, and the `Workspaces` composites hand the SAME hooks reference to `WorkspaceCatalogs` and `WorkspaceSnapshots`.

`worktree()` reads the live tree over the **one shared** `WorkspaceDiscovery` + `WorkspaceCatalogs` path — no second read.

Both reads carry `hookReplays` — `name → version` for every config dependency the hooks layer resolved — so a diff can say WHICH pinned version injected a range. `at(ref)` takes it from the injection, `worktree()` from `WorkspaceCatalogs.hookReplays()` (same memo as `set()`), both projecting the live `HookReplay` record down to its version: WHERE this machine found the pnpmfile (`source`) is machine-local provenance and does not belong on a serializable "what the workspace looked like then" value. Every fresh read sets the field — `{}` under `layerNoop`, with no `configDependencies`, or on the bun/`package.json` path — and it is absent only when decoding a snapshot serialized before it existed.

## `WorkspaceStateSnapshot`

A serializable value (`packages`, `catalogs`, `importerVersions`, `hookReplays`) with lazy `#private` indexes: `versions`, `package(name)`, `resolve(dependency, specifier)` (classified through `@effected/npm`'s `DependencySpecifier`, never prefix-sniffed), `resolveIn(importerPath, dependency, specifier)`, and the snapshot-scoped `catalogResolver` / `workspaceResolver` / `resolvers` layers answering `@effected/npm`'s contracts as of that snapshot. `PackageStateSnapshot` is the narrower per-member slice.

Failure unions: `WorkspaceSnapshotAtFailure` (git errors + `CatalogAssemblyError` from the inline source + `WorkspaceRootNotFoundError`; a malformed *lockfile* at the ref degrades to no catalogs) and `WorkspaceSnapshotWorktreeFailure` (never touches git).

`resolve` is workspace-wide and has no importer context, so it answers only when **every** importer recording that dependency agrees; divergence yields `Option.none()` rather than a wrong answer. `resolveIn(importerPath, …)` is the precise form when the caller knows the importer (`PackageStateSnapshot.relativePath`, `"."` for root).

A `catalog:` specifier resolves in **three** steps and the order is the contract: this moment's own `catalogs` (which, under a replaying hooks layer, already include the ref's hook-injected set), then `seededCatalogs`, then the importer-version fallback. The first two answer with a declared RANGE, the third with a concrete version — which is why a seeded snapshot reports a range change where an unseeded one can only report a version, and why an unseeded pair of refs that installed the same version yields no diff row under `layerNoop`. How the replaying layers reach a past ref's pnpmfile is in [catalogs](./CLAUDE.catalogs.md).

`seededCatalogs` is catalogs supplied from OUTSIDE the moment — the live hook-injected set, or the other side of a diff. **Never merge it into `catalogs`**: that field means "the set assembled at this moment", a snapshot is a value consumers store and diff, and blending would redefine it with nothing able to tell the halves apart. Its LOWER precedence is what makes seeding safe unconditionally — a seed can only add an answer where there was none, so an over-broad seed cannot corrupt a diff. `withSeededCatalogs(seed)` returns a new snapshot and REPLACES any existing seed (merging would make precedence depend on call order); `WorkspaceStateSnapshot.crossSeed(before, after)` is the two-ref form and is the **deliberate exception** — it composes the two seeds rather than replacing, because the layer-level option seeds every snapshot the service returns and a bare replace dropped that seed on both sides at once, silently reopening the gap. Within the composed seed the other ref's catalogs win; the carried seed answers only what neither ref declared. `WorkspaceSnapshotsOptions.seedCatalogs` is the layer-level spelling, applied to `at(ref)` **and** `worktree()` so the two sides of a diff cannot drift on whether they seed.

**What cross-seeding can see depends on the hooks layer, and both cases are pinned.** Under a replaying layer a range change made purely by bumping the config dependency between refs IS detected: `at(ref)` replays each ref's hook at that ref's declared version, so each side's own catalogs carry its range and the seed never gets a say (`__test__/integration/WorkspaceSnapshotsHookReplay.int.test.ts`, on a real repo with the older version installed and the newer one only in a fake store). Under `layerNoop` it stays suppressed, because neither committed source declares the catalog — there, diff `configDependencies` in `pnpm-workspace.yaml`, the only committed evidence (`WorkspaceStateSnapshotSeed.test.ts`). Keep `crossSeed`: harmless under a replaying layer (own catalogs take precedence), still useful under the no-op one.

## Change detection runs on `@effected/git`

`GitReader` is **gone** — the module and its local `GitCommandError` were deleted. `ChangeDetector` runs on `@effected/git`'s `Git` service: `changedFiles(root, { base, head, relative: true })` for the committed range, `workingChanges(root, { relative: true })` for `includeUncommitted`, unioned and sorted.

Every query uses `relative: true` so paths come back relative to the workspace root — correct even when the workspace is nested inside a larger git repository. A non-repository surfaces as git's own `NotARepositoryError` (not re-wrapped); `ChangeDetectionFailure` carries git's typed errors alongside `ChangeDetectionError` and the discovery failures.

`Git` requires core's `ChildProcessSpawner` in `R`, discharged by the consumer's platform layer at the edge. A test provides `Git.layerTest({ … })` — git's own shipped double, whose unstubbed members die named — and needs no repository on disk; hand-enumerating the whole `GitShape` breaks on every growth of that service.

**Related:** [surface](./CLAUDE.surface.md) · [discovery](./CLAUDE.discovery.md) · [catalogs](./CLAUDE.catalogs.md) · [peers](./CLAUDE.peers.md)
