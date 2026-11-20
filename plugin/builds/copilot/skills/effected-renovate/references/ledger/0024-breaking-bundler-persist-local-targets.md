---
id: "0024"
title: "@effected/bundler and @effected/cli: persistLocal resolves against a base and a check mode exists, so PersistLocal.persist, ActionBuilder.build, ActionBundle.build and the decoded persistLocal keys changed shape"
kind: breaking
shows: typed
applies:
  "@effected/bundler": ">=0.7.0"
  "@effected/cli": ">=0.33.0"
detect: ["PersistLocal\\.persist\\(", "ActionBuilder\\.build\\(", "ActionBundle\\.build\\(", "persistLocal\\??\\.(path|actTemplate)", "ActionBuildFailedError"]
---

This applies only to code that calls `@effected/bundler`'s action build helpers directly, or builds an `ActionBuildFailedError`. A repository that builds through `effected action build` needs no change, and `[action.persistLocal]` keeps working as written: a config with no new key behaves as before.

`[action.persistLocal]` gained `base`, `dist` and a check mode, so the helpers that persisted a build changed shape. The compiler finds every call:

- **`PersistLocal.persist`** takes a `ResolvedPersist` from `PersistTarget.resolve(config, { cwd, root })` in place of the `ActionConfig`, and its options are `{ cwd, distDir }`. Resolve the target first, then pass it with the directory that holds the bundles.
- **`ActionBuilderOptions`** gained a required `root`, the workspace root a `base = "workspace"` path resolves against, and a required `check`. Pass `root` and `check: false` where the build only persists.
- **`ActionBundle.build`** takes an optional `outDir`, the absolute directory to bundle into. It defaults to `dist` in `cwd`, and the reported output path stays `dist/<entry>.js`.
- **`persistLocal.path` and `persistLocal.actTemplate`** are optional in the decoded `ActionConfig`, because their defaults depend on `base`. Where a hit reads them as `string` or `boolean`, resolve them through `PersistTarget.resolve` instead.
- **`ActionBuildFailedError`** in `@effected/cli` gained a required `drift` count. Construct it with `drift: 0` where it carries no check result.
- **New failures** reach callers of `ActionBuilder.build` and `ActionRun.run`: `PersistPathError`, `CheckUnavailable`, `NoOutput` and, under `check`, `CheckFailed`. Handle them by tag.

Check the installed `.d.ts` for each helper's options and error channel. Verify with the typecheck.
