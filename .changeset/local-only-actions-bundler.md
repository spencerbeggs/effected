---
"@effected/bundler": minor
---

## Breaking Changes

### `[action.persistLocal]` targets and the persist API

`persistLocal` can now put the action's local copy at the workspace root, and can keep the build out of the package's own `dist/`. The decoded `persistLocal.path` and `persistLocal.actTemplate` are now optional, because their defaults depend on the new `base` key. Code that read them as always present must handle absence.

The programmatic surface changed shape with it:

* `PersistLocal.persist(resolved, { cwd, distDir })` takes the working directory and the bundle directory explicitly.
* `ActionBuilderOptions` requires `root` (the workspace root) and `check`.
* `ActionBundle.build` takes an `outDir`.
* `ActionValidationRunOptions` requires `base`, so `ActionValidation.validate(config, cwd, { ci })` must now pass `{ ci, base }`.

A package-based `path` that was accepted before is now refused with `PersistPathError` (exit 2 from the CLI) when it resolves outside the workspace, is or contains the package, lands in the package's `dist/` or `.action-staging/`, or is or lies inside another package.

## Features

### Workspace-based and dist-less local actions

`[action.persistLocal]` gains two keys:

* `base`: `"package"` (the default) or `"workspace"`. `path` is relative to the package under `"package"` and to the workspace root under `"workspace"`. When `path` is absent it defaults to `.github/actions/local` under the package base and `.github/actions/<package directory name>` under the workspace base. `actTemplate` defaults to `true` under the package base and `false` under the workspace base.
* `dist`: whether the build also stays in the package's own `dist/`. `dist = false` requires `persistLocal.enabled`, and the bundles are staged in `<package>/.action-staging` instead.

```toml
[action.persistLocal]
enabled = true
base = "workspace"
dist = false
```

### Atomic persist

* The persist replaces `dist/` atomically (via `@effected/files`) and leaves other files in the persisted directory alone. `action.yml` is written atomically. A committed symlink at either path is replaced, never written through. Act templates are written only when nothing is at their path (a dangling link included) and are skipped with a warning when their real path leaves the workspace. `PersistLocalResult` gains `actTemplateSkipped` and `ResolvedPersist` gains `root`.

### Persist path safety

A new `PersistTarget.resolve` refuses a persist path that falls outside the workspace, that sits inside or contains the package, or that is or lies inside another package (`reason: "inside-other-package"`, naming it in `packageDir`), with a `PersistPathError`. An action built with `base = "workspace"` that bundles externals now warns, since the persisted copy has no `node_modules` beside it.

### Check mode

A new check mode compares a fresh build against the committed copies without writing anything: `ActionCheck` returns a list of `DriftEntry` values (`target`, `path`, `kind` of `changed`, `missing` or `extra`). New errors report the outcome: `CheckFailed` carries the drift, `CheckUnavailable` and `NoOutput` say why no comparison was possible.

### Published JSON Schema

The `effected.toml` JSON Schema documents the new `base` and `dist` keys.
