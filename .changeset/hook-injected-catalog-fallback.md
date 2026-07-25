---
"@effected/workspaces": minor
---

## Bug Fixes

A `catalog:` specifier that no committed catalog source declares now resolves to the concrete version the lockfile recorded, instead of resolving to nothing on both sides of a diff and hiding a real dependency bump.

This is the shape a pnpm config-dependency pnpmfile hook produces. A workspace declaring `"effect": "catalog:effect:peers"` has that catalog injected at install time, so it appears in neither `pnpm-workspace.yaml` nor the lockfile's `catalogs:` block — pnpm does not record a peer-only catalog. A consumer diffing two snapshots saw the same unresolvable string on both sides, so a genuine `4.0.0-beta.99` to `4.0.0-beta.101` move produced no row and no changeset.

`WorkspaceStateSnapshot.resolve` now falls back to the snapshot's recorded importer versions when the catalog set cannot answer a `catalog:` specifier, and only then. A plain range is unaffected — it is already its own answer.

The fallback reads only committed data, so `WorkspaceSnapshots.at(ref)` and `worktree()` answer identically. Resolving the injected catalog on the worktree side alone would report every run as a change from the raw specifier string to a version.

* Versions are normalized: pnpm's peer-disambiguation suffix (`1.2.3(effect@4.0.0)`) is stripped, so a dependency table shows `1.2.3` rather than the whole parenthesized chain
* `link:` and `file:` importer entries are skipped — a filesystem edge is not a version
* Only pnpm records importer versions; bun and npm workspaces are unaffected

## Features

### Per-importer specifier resolution

`WorkspaceStateSnapshot.resolveIn(importerPath, dependency, specifier)` resolves a specifier scoped to one importer, where `importerPath` is the value `PackageStateSnapshot.relativePath` carries (`"."` for the root package).

`resolve` answers workspace-wide and must abstain when two importers record different versions of the same dependency, because no single answer is correct. `resolveIn` has the importer in hand and answers exactly. Prefer it whenever the caller knows which package is asking.

```ts
// Two packages holding different versions of the same dependency:
snapshot.resolve("effect", "catalog:effect:peers");                  // Option.none()
snapshot.resolveIn(".", "effect", "catalog:effect:peers");           // Option.some("1.0.0")
snapshot.resolveIn("packages/a", "effect", "catalog:effect:peers");  // Option.some("2.0.0")
```

### Recorded importer versions on the snapshot and the catalog service

* `WorkspaceStateSnapshot.importerVersions` — a new optional field carrying importer path to dependency name to resolved version. It is optional so a snapshot serialized before this release still decodes; an absent index makes the fallback inert, which is the behavior those values were captured under.
* `WorkspaceCatalogs.importerVersions()` — the same index for the live workspace, assembled from the same single lockfile read as `set()` and memoized with it. No second read is performed.
* `ImporterVersions` is exported as a new public type.

`WorkspaceCatalogsShape` gains a required `importerVersions` member. Consuming the service is unaffected; a hand-written implementation of that interface would need the new member.
