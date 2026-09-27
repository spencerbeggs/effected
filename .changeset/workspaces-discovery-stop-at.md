---
"@effected/workspaces": minor
---

## Features

### Cap the workspace root ascent with `stopAt`

`WorkspaceDiscoveryOptions`, `LockfileReaderOptions`, `WorkspaceCatalogsOptions`, `WorkspaceSnapshotsOptions` and `WorkspacesOptions` gain `stopAt`, a ceiling for the root ascent from `cwd`. It is passed through to `WorkspaceRoot.find`, so it is inclusive and resolved to an absolute path. A checkout nested under another directory's workspace used to adopt that outer workspace. With `stopAt: cwd` it now fails with `WorkspaceRootNotFoundError`, carrying the ceiling. A checkout that is itself a workspace root still resolves.

* Every `Workspaces.*` composite forwards one `stopAt` to every service it builds, so discovery, lockfile, catalog and snapshot reads all refuse the enclosing workspace together.
* `WorkspacesOptions` now extends the per-service option shapes it forwards, so an option a service grows reaches the composites too.
* `Workspaces.localExecLayer` takes `stopAt` as well. A ceiling with no root below it gives the same `Option.none()` as no root at all.
* The ceiling applies to layer-bound lookups only. `WorkspaceDiscovery`'s `infoIn`, `listPackagesIn` and `refreshIn` take a directory per call and still ascend unbounded.
* The default is no ceiling, so existing callers see no change.

## Bug Fixes

### The not-found message names the `workspaces` field

`WorkspaceRootNotFoundError.message` now reads `package.json with a "workspaces" field` where it said `package.json`. Only a manifest with that field marks a root, and the old wording claimed a single-package repository lacked a file it plainly has. The `markers` field and `WORKSPACE_MARKERS` are unchanged.
