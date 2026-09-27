---
"@effected/workspaces": minor
---

## Features

### `findWorkspaceRootSync` stop boundary

`findWorkspaceRootSync(cwd, options)` accepts an optional `stopAt` via the new exported `FindWorkspaceRootSyncOptions`, closing #846. The bound is inclusive, a relative path resolves against `process.cwd()` at lookup time, and the ascent returns `null` once it passes `stopAt` without finding a workspace root. Omitting `stopAt` keeps the ascent unbounded, matching prior behavior.

```ts
import { findWorkspaceRootSync } from "@effected/workspaces";
import { nodeSyncOps } from "@effected/workspaces/node-sync";

const root = findWorkspaceRootSync(process.cwd(), { ...nodeSyncOps, stopAt: process.cwd() });
```

### `reason: "no-version"` on version-less resolution failures

Part of #612: a `versionOf` failure caused by a workspace member declaring no `version` — from both `WorkspaceDiscovery` and the snapshot resolvers — now carries `reason: "no-version"` and no `cause`, matching `@effected/npm`'s `DependencyResolutionError` shape.

## Bug Fixes

`LockfileReader` passes `configOnly` to `Lockfile.parse` only when the workspace root has no `package.json`, so a config-dependency-only pnpm workspace reads as an empty lockfile while the same bytes left by an interrupted first install fail with `LockfileFramingError` instead of reading as a clean, empty workspace.

## Breaking Changes

`PackageStateSnapshot.version` is now optional and is never the empty string. Both capture paths omit `version` for a workspace member with no declared version instead of recording `""`, `PackageStateSnapshot.make` rejects an explicit `""`, and a snapshot serialized under the old `""` sentinel decodes to the field being absent. As a consequence, `WorkspaceStateSnapshot.versions` now lists only members that declared a version — use `package(name)` to check membership instead, since a version-less member no longer appears there. Closes #613.
