---
"@effected/engine": minor
---

## Features

### BuildWatch

`@effected/engine/build` gains `BuildWatch`, the watch loop behind `effected package build --watch` and `effected action build --watch`.

* `BuildWatch.run` watches a package directory (plus the root config tier when the package is not the workspace root), debounces events into batches, and runs one build at a time. Changes made during a build become a single follow-up build.
* `BuildWatch.target` resolves the directories a watch covers. `BuildWatch.packageExcludes` adds the in-package `[package.build.meta] localPaths` directories a package build copies its API model into, and `BuildWatch.actionExcludes` adds an action's enabled `persistLocal.path`, unless `persist: false`.
* `DEFAULT_EXCLUDES` lists what every watched build ignores: `dist`, `node_modules`, `.turbo`, `.git`, `.cache` and the other files a build writes, so a build never triggers itself.
* The types `WatchTrigger`, `BuildWatchOptions` and `WatchTarget` are exported alongside.
