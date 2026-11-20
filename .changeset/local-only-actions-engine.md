---
"@effected/engine": minor
---

## Breaking Changes

* `ActionRunInput.check` is a new required field, so every programmatic `ActionRun.run` call must pass `check` (`false` for a plain build).
* `ActionRun.run` propagates `PersistPathError`, `CheckUnavailable` and `NoOutput` from `@effected/bundler`. Callers that handle `ActionRun.run` errors exhaustively must handle these.

## Features

### Check and local-only actions

* `ActionRun.run` supports `check`: it writes nothing, and a check that finds drift still succeeds, answering the verdict `"failed"` with the drift in `result.drift`.
* `ActionInit` takes `local`, scaffolding a local-only action: `[action.persistLocal]` with `base = "workspace"` and `dist = false`, plus a `.gitignore` for the staging directory.

## Bug Fixes

* `--watch` excludes `.action-staging` from its watched paths and resolves the persist path by `base`, so a dist-less action no longer retriggers itself.
