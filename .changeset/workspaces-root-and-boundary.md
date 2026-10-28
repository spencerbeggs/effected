---
"@effected/workspaces": minor
---

## Features

* `WorkspaceRoot.locate(cwd, options)` answers a `WorkspaceRootMatch` as an Effect, from `FileSystem` and `Path` in `R`. It shares one ascent with `find`, so the two cannot disagree on a root. `WorkspaceRootShape` is unchanged, so hand-written `find` doubles keep compiling.
* Root lookups filter by `markers` and report the matched file, so a pnpm-only tool is not stopped by a member that keeps `package.json` `workspaces`.
* `SourceBoundary` gains `forbidImportedNames`: forbid the named exports of one module while leaving its other exports free. It reads named, type-only and default bindings, named re-exports, `export *`, namespace member access, string-literal names and `import m = require("m")`. Dynamic import, `require` and computed members are documented misses (#1124).

## Bug Fixes

* `WorkspaceDiscovery`, `LockfileReader`, `WorkspaceCatalogs`, `WorkspaceSnapshots`, the `Workspaces` composites and `localExecLayer` forward `markers` wherever they forwarded `stopAt`, so a layer-bound lookup no longer picks a different root than the sync helpers (#1130).
* `@effected/source` now has its own bottom layer in the workspace layering.
