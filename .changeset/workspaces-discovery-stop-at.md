---
"@effected/workspaces": minor
---

## Features

### Cap discovery's root ascent with `stopAt`

`WorkspaceDiscoveryOptions` gains `stopAt`, a ceiling for the root ascent from `cwd`. It is passed through to `WorkspaceRoot.find`, so it is inclusive and resolved to an absolute path. A checkout nested under another directory's workspace used to adopt that outer workspace's members. With `WorkspaceDiscovery.layer({ cwd, stopAt: cwd })` it now fails with `WorkspaceRootNotFoundError`, carrying the ceiling. A checkout that is itself a workspace root still resolves.

* The ceiling applies to the layer-bound methods only. `infoIn`, `listPackagesIn` and `refreshIn` take a directory per call and still ascend unbounded.
* The default is no ceiling, so existing callers see no change.

## Bug Fixes

### The not-found message names the `workspaces` field

`WorkspaceRootNotFoundError.message` now reads `package.json with a "workspaces" field` where it said `package.json`. Only a manifest with that field marks a root, and the old wording claimed a single-package repository lacked a file it plainly has. The `markers` field and `WORKSPACE_MARKERS` are unchanged.
