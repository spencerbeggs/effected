---
id: "0001"
title: "The build moves from @savvy-web/bundler and savvy.build.ts to effected package build and effected.toml"
kind: tooling
shows: behavioural
applies:
  "@effected/plugin": ">=0.3.0"
detect: ["savvy\\.build\\.ts", "\"@savvy-web/bundler\"", "publishConfig\\.directory|linkDirectory", "build:(dev|prod)"]
changesets: ["bright-tools-build", "calm-bundles-build", "keen-builds-land", "proud-presets-ship", "quick-agents-build"]
---

The kit no longer builds with `@savvy-web/bundler`. `@effected/plugin` carries the replacement: `effected package build` reads an optional `effected.toml`, and most packages need no file at all. An action repository's `build:prod` hit belongs to the `effected action build` entry, not this one.

1. **Install the tool.** Add `@effected/plugin` through `catalog:effected` as a root devDependency, if it is not there already. Its `typescript` peer is `7.1.0-beta || 7.1.0-rc || >=7.1.0 <8`, so check the repository's TypeScript satisfies it.
2. **Remove the old builder.** Delete `@savvy-web/bundler` from every package's devDependencies and delete each `savvy.build.ts`, after moving its options (step 6).
3. **Replace the scripts.** `build:dev`, `build:prod` and `prepare` become one script, `"build": "effected package build"`. There is no dev build and no target flag.
4. **Replace the turbo tasks.** `build:dev` and `build:prod` become `build`, with `dependsOn: ["types:check"]`. `types:check` now has `dependsOn: ["^types:check"]`, because nothing has to be built before a typecheck.
5. **Remove the link directory.** Delete `publishConfig.directory` and `publishConfig.linkDirectory`. Workspace links resolve through `exports` to `src/`. Anything that reads `dist/dev` has to stop; there is no such tree.
6. **Move each `build({...})` option to `effected.toml`.** Tables are `[package.build]`, `[package.build.meta]` and `[package.tsdoctor]`. Decoding is strict, so a key that did not survive fails the build by name instead of being ignored.
   - `dtsExternals`, `externals`, `bundledPackages`, `bundleNodeModules` and `exe` keep their names under `[package.build]`. `formats` is `format`.
   - `meta.tsdoc.suppressWarnings` and `meta.tsdoc.tagDefinitions` move to `[package.build.meta.tsdoc]`. The `{ messageId: "ae-forgotten-export", pattern: "_base" }` rule is now the default, so delete it unless the list has other rules: a list you write replaces the default, so keep it there in that case.
   - `meta.localPaths` and `devManifest` are gone. Delete them.
   - `plugins` is a list of module paths resolved against the package directory, not plugin values. A module's default export is a rolldown plugin or a factory of one. Move an inline plugin to its own file.
   - `transform` has no function form. `[package.build.manifest] drop = [...]` lists the top-level keys to drop from the emitted `package.json`. A transform that rewrites a value has no counterpart, so check each one before you delete it.
   - `tsdoctor` moves to `[package.tsdoctor]`.
   - `groups` and `targets` are gone. `publishConfig.targets` in `package.json` decides the publish groups.
7. **Repoint the tsconfig.** Each `extends` of `@savvy-web/bundler/tsconfig/ecma.json` becomes `@effected/plugin/tsconfig/ecma.json`.
8. **Ignore the journals.** Each build appends to `.cache/effected/build.jsonl` and `.cache/effected/issues.jsonl` at the workspace root, so add `.cache` to `.gitignore`.

A repository that installs the tool from npm runs a built bin and needs nothing else. Only a pnpm 12 workspace that runs its `effected` bin from source also needs `nodeOptions: --import=tsx` in `pnpm-workspace.yaml`.

The artifacts keep their paths: `dist/prod/<group>/{pkg,meta}`, `dist/prod/targets.json` and `dist/prod/issues.json`. Readers of those need no change.

Verify by running `effected package build` once in one package and reading `dist/prod/issues.json`. Check `buildOk` first, and compare the warnings against the previous build's. A turbo cache hit replays a clean log, so `generatedAt` must postdate your edit. Read the installed `.d.ts` for `@effected/bundler`'s `BuildConfig` for the exact shape of a key.
