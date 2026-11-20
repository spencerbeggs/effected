---
"@effected/engine": minor
---

## Breaking Changes

* `ActionRun.run` takes a `check` option and, on a failed check, fails with the drift list instead of writing output. It also propagates `PersistPathError`, `CheckUnavailable` and `NoOutput` from `@effected/bundler`. Callers that handle `ActionRun.run` errors exhaustively must handle these.

## Features

### Check and local-only actions

* `ActionRun.run` supports `check`, returning the drift a failed verdict found.
* `ActionInit` takes `local`, scaffolding a local-only action: `[action.persistLocal]` with `base = "workspace"` and `dist = false`, plus a `.gitignore` for the staging directory.

## Bug Fixes

* `--watch` excludes `.action-staging` from its watched paths and resolves the persist path by `base`, so a dist-less action no longer retriggers itself.
