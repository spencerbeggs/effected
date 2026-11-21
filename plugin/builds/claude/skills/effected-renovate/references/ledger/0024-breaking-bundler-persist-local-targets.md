---
id: "0024"
title: "@effected/bundler, @effected/cli and @effected/engine: persistLocal resolves against a base and a check mode exists, so PersistLocal.persist, ActionBuilder.build, ActionBundle.build, ActionRun.run and the decoded persistLocal keys changed shape"
kind: breaking
shows: typed
applies:
  "@effected/bundler": ">=0.7.0"
  "@effected/cli": ">=0.33.0"
  "@effected/engine": ">=0.20.0"
detect: ["PersistLocal\\.persist\\(", "ActionBuilder\\.build\\(", "ActionBundle\\.build\\(", "ActionValidation\\.validate\\(", "persistLocal\\??\\.(path|actTemplate)", "ActionBuildFailedError", "ActionRun\\.run\\(", "ActionRunInput"]
changesets: ["local-only-actions-bundler", "local-only-actions-cli", "local-only-actions-engine"]
---

This applies only to code that calls `@effected/bundler`'s action build helpers or `@effected/engine`'s `ActionRun.run` directly, or builds an `ActionBuildFailedError`. A repository that builds through `effected action build` needs no change, and a config with no new key keeps its defaults, with one exception: a package-based `path` that resolves outside the workspace, is or contains the package, lands in its `dist/` or `.action-staging/`, or is or lies inside another package is now refused with exit 2. Move such a `path` to a directory of its own.

`[action.persistLocal]` gained `base`, `dist` and a check mode, so the helpers that persisted a build changed shape. The compiler finds every call:

- **`PersistLocal.persist`** takes a `ResolvedPersist` from `PersistTarget.resolve(config, { cwd, root })` in place of the `ActionConfig`, and its options are `{ cwd, distDir }`. Resolve the target first, then pass it with the directory that holds the bundles.
- **`ActionBuilderOptions`** gained a required `root`, the workspace root a `base = "workspace"` path resolves against, and a required `check`. Pass `root` and `check: false` where the build only persists.
- **`ActionBundle.build`** takes an optional `outDir`, the absolute directory to bundle into. It defaults to `dist` in `cwd`, and the reported output path stays `dist/<entry>.js`.
- **`ActionValidationRunOptions`** gained a required `base`, so `ActionValidation.validate(config, cwd, { ci })` no longer typechecks. Pass `{ ci, base }`, with `base` from the resolved persist target or `"package"`.
- **`persistLocal.path` and `persistLocal.actTemplate`** are optional in the decoded `ActionConfig`, because their defaults depend on `base`. Where a hit reads them as `string` or `boolean`, resolve them through `PersistTarget.resolve` instead.
- **`ActionBuildFailedError`** in `@effected/cli` gained a required `drift` count. Construct it with `drift: 0` where it carries no check result.
- **`ActionRunInput`** in `@effected/engine` gained a required `check`, so every `ActionRun.run` call must pass it. Pass `check: false` for a plain build.
- **New failures** reach callers: `ActionBuilder.build` and `ActionRun.run` can fail with `PersistPathError`, `CheckUnavailable` and `NoOutput`. Under `check`, `ActionBuilder.build` fails with `CheckFailed`, while `ActionRun.run` catches it and succeeds with the verdict `"failed"`, the drift in `result.drift`. Handle the failures by tag, and read the verdict.

Check the installed `.d.ts` for each helper's options and error channel. Verify with the typecheck.
