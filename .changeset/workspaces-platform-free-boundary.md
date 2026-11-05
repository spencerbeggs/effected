---
"@effected/workspaces": minor
---

## Features

* `SourceBoundary.platformFree(builtins)` (#1196) builds the boundary rule for platform-free code: every Node built-in, bare or `node:`-prefixed, and `@effect/platform*`. Pass `builtinModules` from `node:module` as `builtins`.
