---
id: "0001"
title: "The build moves from @savvy-web/bundler and savvy.build.ts to effected package build and effected.toml"
kind: tooling
shows: behavioural
applies:
  "@effected/plugin": ">=0.3.0"
detect: ["savvy\\.build\\.ts", "\"@savvy-web/bundler\"", "publishConfig\\.directory|linkDirectory", "build:(dev|prod)"]
changesets: ["bright-tools-build", "calm-bundles-build", "keen-builds-land", "proud-presets-ship", "quick-agents-build", "literal-exports-emit"]
---

The kit no longer builds with `@savvy-web/bundler`. `@effected/plugin` carries the replacement: `effected package build` reads an optional `effected.toml`, and most packages need no file at all. An action repository's `build:prod` hit belongs to the `effected action build` entry, not this one.

1. **Install the tool.** Add `@effected/plugin` through `catalog:effected` as a root devDependency, if it is not there already. Its `typescript` peer is `7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`, so check the repository's TypeScript satisfies it.
2. **Remove the old builder.** Delete `@savvy-web/bundler` from every package's devDependencies and delete each `savvy.build.ts`, after moving its options (step 6).
3. **Replace the scripts.** `build:dev`, `build:prod` and `prepare` become one script, `"build": "effected package build"`. There is no dev build and no target flag.
4. **Replace the turbo tasks.** `build:dev` and `build:prod` become `build`, with `dependsOn: ["types:check"]`. `types:check` now has `dependsOn: ["^types:check"]`, because nothing has to be built before a typecheck.
5. **Remove the link directory.** Delete `publishConfig.directory` and `publishConfig.linkDirectory`. Workspace links resolve through `exports` to `src/`. Anything that reads `dist/dev` has to stop; there is no such tree.
6. **Move each `build({...})` option to `effected.toml`.** Tables are `[package.build]`, `[package.build.meta]` and `[package.tsdoctor]`. Decoding is strict, so a key that did not survive fails the build by name instead of being ignored.
   - `dtsExternals`, `externals`, `bundledPackages`, `bundleNodeModules` and `exe` keep their names under `[package.build]`. `formats` is `format`.
   - `meta.tsdoc.suppressWarnings` and `meta.tsdoc.tagDefinitions` move to `[package.build.meta.tsdoc]`. The `{ messageId: "ae-forgotten-export", pattern: "_base" }` rule is now the default, so delete it unless the list has other rules: a list you write replaces the default, so keep it there in that case.
   - `meta.localPaths` keeps its name, under `[package.build.meta]`, as paths relative to the package. `devManifest` is gone, so delete it.
   - A post-build script that copies non-module assets into the package becomes `[package.build] copy = [...]`, or a `public/` directory, which is copied with no config. `from` is relative to the package and `to` to the emitted package root. A directory `from` keeps its own basename under `to`: `copy = ["../../schemas"]` ships `pkg/schemas/...`, while `{ from = "../../schemas", to = "schemas" }` nests it as `pkg/schemas/schemas/...`. A pattern export matching nothing emitted, or a literal `exports` or `bin` target naming no emitted file, warns as `exports-pattern-unmatched`. A literal target written as the built file (`./dist/foo.js`) is rewritten to the file the build emits, while a `*` pattern over build sources (`./dist/*.js`, `./src/*.ts`), a `*` key over one literal source and a condition object naming the executable fail at config validation, so rewrite those as one literal export per entry; an `exports` `*` spans `/` (Node semantics), so a file at a deeper path than intended still satisfies the pattern and the warning cannot catch a wrongly nested copy.
   - `bundledPackages` naming a workspace sibling inlines the sibling's built declarations, so that package's own `turbo.json` needs `dependsOn: ["^build"]` on `build`. A subpath inlines only when listed.
   - `plugins` is a list of module paths resolved against the package directory, not plugin values. A module's default export is a rolldown plugin or a factory of one. Move an inline plugin to its own file.
   - `transform` has no function form. `[package.build.manifest] drop = [...]` lists the top-level keys to drop from the emitted `package.json`. A transform that rewrites a value has no counterpart, so check each one before you delete it.
   - `tsdoctor` moves to `[package.tsdoctor]`.
   - `groups` and `targets` are gone. `publishConfig.targets` in `package.json` decides the publish groups.
7. **Repoint the tsconfig.** Each `extends` of `@savvy-web/bundler/tsconfig/ecma.json` becomes `@effected/plugin/tsconfig/ecma.json`.
8. **Ignore the journals.** Each build appends to `.cache/effected/build.jsonl` and `.cache/effected/issues.jsonl` at the workspace root, so add `.cache` to `.gitignore`.

A repository that installs the tool from npm runs a built bin and needs nothing else. Only a pnpm 12 workspace that runs its `effected` bin from source also needs `nodeOptions: --import=tsx` in `pnpm-workspace.yaml`. That setting is repo-global: every process a pnpm script starts inherits it, and a tool that loads its own bundles can break, `rspress build` being the known case. The escape is `NODE_OPTIONS=` at the front of that script. A root `build` script also uses `--filter=!docs` when a website package has its own `build` task.

**Self-hosting repositories.** A root that depends on its own carrier through `workspace:*` runs that carrier's bins from source, and `.bin/<tool>` under a hook, an MCP loader or a bare shell has no `nodeOptions`. Have the bin file register tsx itself when it runs from `.ts`, by the guarded import in `effect-v4-cli`'s bin-only-package reference, with `tsx` as a root devDependency. Then `.bin/<tool>` works outside pnpm. The contract: a SOURCE bin self-registers tsx; a BUILT bin's self-registration branch is dead, and in a linked workspace that built bin still imports siblings from source, so a test that spawns a built bin in the workspace passes `--import <absolute file URL of tsx>` (as the kit's own `packages/cli/__test__/e2e/*.e2e.test.ts` do); an installed consumer needs nothing. Put `/** @jsxRuntime automatic */` at the top of every `.tsx` file too: tsx applies one tsconfig per process, found from the working directory, so a linked package's JSX can compile to classic `React.createElement`, and a TTY run of a live view then fails with `React is not defined` while a captured run stays green. Verify on a real pty.

The artifacts keep their paths: `dist/prod/<group>/{pkg,meta}`, `dist/prod/targets.json` and `dist/prod/issues.json`. Readers of those need no change.

Verify by running `effected package build` once in one package and reading `dist/prod/issues.json`. Check `buildOk` first, and compare the warnings against the previous build's. A turbo cache hit replays a clean log, so `generatedAt` must postdate your edit. Read the installed `.d.ts` for `@effected/bundler`'s `BuildConfig` for the exact shape of a key.
