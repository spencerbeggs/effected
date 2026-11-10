---
type: Interface
title: "effected.toml: the build config's tables, defaults and discovery"
description: "The contract of effected.toml: every [package.build], [package.bundle] and [action] key with its default, the two tiers it is discovered in and how they merge (objects per key, arrays and scalars replace), the strict single decode that fails an unknown key with its path, and the two keys through which code enters a build."
status: draft
kind: config
resource: ../../packages/bundler/src/config/BuildConfig.ts
tags:
  - dx
  - architecture
sources:
  - id: build-config
    resource: ../../packages/bundler/src/config/BuildConfig.ts
  - id: action-config
    resource: ../../packages/bundler/src/config/ActionConfig.ts
  - id: config-file
    resource: ../../packages/bundler/src/config/EffectedConfigFile.ts
  - id: merge
    resource: ../../packages/bundler/src/config/merge.ts
  - id: plugins
    resource: ../../packages/bundler/src/config/plugins.ts
  - id: manifest-set
    resource: ../../packages/bundler/src/manifest/manifest-set.ts
  - id: built-condition
    resource: ../../packages/bundler/src/manifest/built-condition.ts
  - id: runtime-e2e
    resource: ../../packages/bundler/__test__/e2e/runtime-subdir.e2e.test.ts
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-10T21:32:36Z
integrity:
  generated:
    body: 10cce91566a71047
---

# effected.toml: the build config's tables, defaults and discovery

`effected.toml` is what [`effected package build` and `effected action build`](build-commands.md) read. [Why it is the only build config](../decisions/effected-toml-is-the-build-config.md) is a Decision; this is what a config author can rely on. Every key has a default or may be absent, so no file at all is a complete config, and most packages need none.

## Discovery and merge

There are two tiers. **Within a tier the first file found is the only one read; across tiers the package merges over the root.**[^config-file]

| Tier | Candidates, first found wins | Applies |
| --- | --- | --- |
| Root | `.config/effected.toml`, `effected.toml` | under the workspace root, which is the package directory when no root sits above it |
| Package | `.config/effected.toml`, `effected.toml`, `lib/configs/effected.toml` | under the package directory, when it is not the root |

The merge runs on the raw documents before any decoding, so a default can never outrank a value the root wrote:[^merge]

- **Two tables merge per key.**
- **An array or a scalar replaces whatever the root had, whole.** A package's `externals` does not add to the root's.
- `__proto__`, `constructor` and `prototype` keys are dropped.

A table the root writes reaches every package under it, `[action]` included, and that makes each of them an action to `effected action build`.

## Decoding

The merged document decodes once, strictly. An unknown key is a failure rather than a default taken silently, and every issue is reported at once. `EffectedConfigError` names the file and carries each issue's dotted path, such as `package.build.formats`; the file blamed is the tier that wrote what the first issue points at.[^config-file] A build then refuses further things no schema can state, such as an `exe` with more than one binary or target, an `outSubdir` override pinning more than one export, or an override naming a path that is not an export; those fail `ConfigValidationError`, before any build work.

## `[package.build]`

| Key | Default | Meaning |
| --- | --- | --- |
| `format` | `["esm"]` | Output module formats, `esm` and `cjs` |
| `externals` | `[]` | Packages kept external |
| `bundle` | `[]` | Packages force-bundled into the JS output; declarations are not inlined by this |
| `bundledPackages` | `[]` | External packages whose declarations are inlined into the bundled `.d.ts`. [A workspace sibling inlines from its build](#inlining-a-workspace-sibling) |
| `dtsExternals` | `[]` | Packages externalized in the declaration pass only; declare them as dependencies so consumers can resolve the emitted imports |
| `bundleNodeModules` | `false` | Bundles non-external `node_modules` and workspace dependencies into the JS and the declarations |
| `minify` | `false` | Minifies the output |
| `emitDts` | `true` | Runs the declaration pass and, with it, the meta pass |
| `define` | `{}` | Compile-time replacements, inserted verbatim, so a string literal carries its own quotes |
| `plugins` | `[]` | See [the two code keys](#the-two-code-keys) |
| `overrides` | `[]` | `[[package.build.overrides]]`: format and bundling settings pinned to some export paths |
| `looseFiles` | `{}` | Standalone files at literal output paths, outside the exports, declaration and meta graph: a source path or `{ source, format? }` |
| `copy` | `[]` | [Non-module assets](#non-module-assets) copied into each group's `pkg/`: a path or glob, or `{ from, to?, flatten? }` |
| `jsx` | inferred from the tsconfig | `{ runtime?, importSource? }`, with `runtime` `automatic` or `classic` |
| `manifest` | `{ drop = [], set = {} }` | Keys dropped from and [written over](#renaming-the-emitted-package) the emitted `package.json` |
| `meta` | a table of defaults | The API model's settings, or `false` to opt out and still run the declaration pass |
| `exe` | absent | One single-executable binary to compile |

An override's `entries` is required and each must be a canonical export path, `"."` or `"./sub"`. It may set `format`, `bundle`, `externals`, `bundleNodeModules`, `bundledPackages`, `dtsExternals`, `platform` (`node` when absent, or `browser`, `neutral`), `css` and `outSubdir`. An unset key means the base build's value.[^build-config]

### Shipping a directory one file per source

An override with `outSubdir` builds its one export as a sub-package under `pkg/<outSubdir>/`, one compiled file per source, mirroring the tree under the export's source directory. It ships every `.ts`/`.tsx` file in that directory, including files the export never imports, and leaves out `*.test.*`, `*.spec.*` and `.d.ts` files. Each file keeps its own imports, so packages listed in `externals` (or declared as dependencies or peers) stay imports for whoever compiles the files next. That is the shape a framework runtime needs, where a site's own build compiles the runtime per site (the role `@savvy-web/rspress-builder`'s `runtime: true` played):[^runtime-e2e]

```toml
[package.build]
externals = ["@rspress/core"]

[[package.build.overrides]]
entries = ["./runtime"]          # "./runtime": "./src/runtime/index.tsx" in package.json
outSubdir = "runtime"            # pkg/runtime/components/<Name>/index.js, and so on
platform = "browser"
externals = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "@rspress/core", "@theme"]
css = { modules = { localsConvention = "camelCaseOnly", namedExport = false }, inject = true }
```

- **`import.meta.env` is left alone.** The build defines only `process.env.__PACKAGE_VERSION__` and your `define` keys, so `import.meta.env.SSG_MD` reaches the shipped files unresolved and the site's build decides it. tsdown does define `import.meta.env.<KEY>` and `process.env.<KEY>` for every `TSDOWN_`-prefixed variable in the build's environment, so do not name a runtime variable `TSDOWN_*`.
- **The export gets a barrel and its declarations,** `./runtime` pointing at `./runtime/index.{js,d.ts}` in the emitted manifest. A `css` setting needs `@tsdown/css` installed in the package.
- **One export per `outSubdir` override,** and the directory shipped is the one holding the export's source.

### Renaming the emitted package

`[package.build.manifest] set` writes top-level string keys over the emitted `package.json`, after `drop`:

```toml
[package.build.manifest]
drop = ["devDependencies"]
set = { name = "@modules/versioned", description = "The v1 line" }
```

- **`set.name` renames everything the build names,** not only the manifest: every publish group without a `name` of its own in `publishConfig.targets`, `targets.json`, and the API model's `<unscoped>.api.json` and its import specifiers. So two workspace packages, which pnpm requires to have distinct names, can both emit as one published name. `issues.json` and the journals still name the workspace package that was built, and the meta pass's optimistic version is read under the source name.
- **It refuses keys owned by something else,** failing `ConfigValidationError` at `manifest.set.<key>` before any pass: `version` (changesets bump it and the release tags it), `private` (derived from `publishConfig.access`), `type`, `exports`, `bin`, `files`, `main`, `module`, `types` and `typings` (the build writes or replaces them), the dependency maps, and the always-stripped build-only fields. A key also listed in `drop`, an empty key, and a `name` npm would not accept are refused too.
- **It writes only keys package.json types as a string:** `name`, `description`, `homepage`, `license`, and the string forms of `author`, `bugs`, `funding`, `repository`, `browser` and `man`. Every other key, such as `sideEffects`, `keywords`, `os`, `cpu`, `engines` or `imports`, takes a boolean, an array or an object, and a string written over it would publish the wrong type, so it is refused. A non-string value fails the decode.[^manifest-set]
- **A renamed package publishes under the emitted name, while the release keeps the source name.** Changesets, the CHANGELOG and the git tag name the workspace package, and the registry receives the emitted one. Two workspace packages that emit one name share one npm version line, so their own versions must never meet: a second publish of a version the first already took fails. `set.name` suits a docs-only pair, such as two fixture modules a site documents as v1 and v2, better than two published lines.
- **`PackedInstall` cannot take a renamed package as an override.** It refuses a replacement whose packed manifest names a package other than the one it replaces.

### Linking built output to a plain-Node consumer

Workspace links resolve to `src/`, which tsx and vitest load and plain Node does not. A workspace consumer that loads a sibling in plain Node, such as a framework CLI (`rspress build`) importing a workspace plugin that imports workspace libraries, needs the sibling's built JS. Name it in the source `package.json` under the `effected-built` condition, first:

```json
"exports": {
  ".": { "effected-built": "./dist/prod/npm/pkg/index.js", "default": "./src/index.ts" }
}
```

and run the consumer with the condition, after the siblings have built:

```json
"build": "NODE_OPTIONS=--conditions=effected-built rspress build"
```

- **Nothing else changes.** Vitest, tsx and TypeScript do not match an unknown condition, so they fall through to the source, and the kit's rule that workspace links resolve to `src/` still holds for them.
- **`--conditions` reaches Node's own resolver, and no bundler's.** A bundler resolves with its own condition list, which ignores Node's flags, so code it compiles needs `effected-built` in that list as well. For rspress, a probe of rspress 2.1.1 on Node 26 settled both halves:
  - `rspress build` loads `rspress.config.ts` through `@rsbuild/core`'s `loadConfig`. That is a native `import()` whenever Node strips types, and jiti only if that throws. So the plugin it imports resolves to the built file under `NODE_OPTIONS=--conditions=effected-built`.
  - The runtime pages import is bundled by rspack, which resolved to source with the flag alone and failed on its `./x.js` imports, because `--conditions` never reaches it. Prepending the condition to rspack's list made it resolve to the built runtime:

    ```ts
    builderConfig: {
      tools: {
        rspack: (config) => {
          config.resolve ??= {};
          config.resolve.conditionNames = ["effected-built", ...(config.resolve.conditionNames ?? ["..."])];
          return config;
        },
      },
    },
    ```

- **It never publishes.** The build strips the condition before it reads the exports, so the published manifest and the `pkg/` tree are the same as without it.
- **The build checks the target.** It must be the first key of a subpath's condition object, because Node takes the first condition it matches and `import` and `default` match in plain Node too. It must be a literal path under `./dist/prod/`, followed by an `import` or `default` condition naming the source, and must not nest or sit in a root-level condition object. Each of those fails `ConfigValidationError`. A target that is not the file a group emitted for that export is a `warn` in `issues.json`, code `exports-built-condition-unmatched`, naming the path to write.
- **Every package on the chain declares it,** since each built file imports its siblings by name, and the consumer's turbo task needs `dependsOn: ["^build"]` so they are built first. `NODE_OPTIONS=` replaces the root's `--import=tsx` for that script, which [rspress cannot run under](../decisions/bundler-bootstraps-from-source.md).[^built-condition]
- **Publish from `dist/prod`, not from source.** A package published from its source directory ships the condition and a `dist/prod` path its tarball does not contain, as it would ship its `src` exports. The kit's sources are `"private": true`, and the release packs `pkg/`.

`[package.build.meta]`:

| Key | Default | Meaning |
| --- | --- | --- |
| `localPaths` | `[]` | Directories, relative to the package, that the canonical group's API model is copied into: the `.api.json`, the meta `package.json` and `tsconfig.json`, and `bundle.json` when one was emitted. For a docs site that reads the model from its own tree |
| `optimistic` | `"auto"` | Forward-looks the meta bundle's versions from pending changesets. `auto` is `false` under CI and `true` locally |
| `tsdoc.suppressWarnings` | `[{ messageId = "ae-forgotten-export", pattern = "_base" }]` | API Extractor messages to suppress. A list **replaces** the default, so an empty one suppresses nothing |
| `tsdoc.tagDefinitions` | `[]` | Custom TSDoc tags: `{ tagName, syntaxKind, allowMultiple? }` |

### Non-module assets

A `public/` directory needs no config: its contents are copied verbatim into each group's `pkg/` root. `copy` is the explicit way, for files that live elsewhere, and is tsdown's `copy` option as data.

```toml
[package.build]
copy = ["../shared/schemas", { from = "assets/*.png", to = "img" }]
```

- **`from`, or a bare string, is a path or glob relative to the package directory.** A directory is copied whole and keeps its own basename under `to` (tsdown semantics), so `../shared/schemas` lands at `pkg/schemas`. To ship `schemas/` at the package root write `copy = ["../../schemas"]`; `copy = [{ from = "../../schemas", to = "schemas" }]` nests it as `pkg/schemas/schemas/...`.
- **`to` is relative to the group's `pkg/` root**, where tsdown alone would read it against the package directory and put every group's copy in one place. One that leaves `pkg/` fails `ConfigValidationError`.
- **`flatten` defaults to `true`**, dropping each source's directories.
- **A package that only compiles a binary runs no JS pass,** so `copy` there fails `ConfigValidationError` rather than doing nothing.

An `exports` or `bin` target that names no file in the emitted package is a `warn` in `issues.json`, with `source: "config"` and code `exports-pattern-unmatched`: a pattern such as `./schemas/*.json` that matches nothing, or a literal path that does not exist. The single-executable path is exempt, so a `--no-exe` build does not warn. It does not fail the build. An `exports` `*` spans `/` (Node semantics), so a file at a deeper path than intended still satisfies the pattern and the warning cannot catch a wrongly nested copy.

A literal export or `bin` target written as the built file, such as `./dist/foo.js`, is rewritten to the file the build emits for it, including an executable's entry, which points at the binary. A `*` pattern over build sources (`./dist/*.js`, `./src/*.ts`), a `*` export key over a literal build source, and a condition object naming the executable source fail `ConfigValidationError` before any pass.

### Inlining a workspace sibling

A sibling resolves to source, and the declaration pass cannot declare source outside its own project, so a `bundledPackages` entry that is a sibling inlines from **the sibling's built declarations**, as a registry package's would. An entry is a sibling when the realpath of `node_modules/<name>` lies inside the workspace root and outside any `node_modules`.

- **The sibling has to be built first.** With no `dist/prod/<canonical group>/pkg/index.d.ts`, the build fails `ConfigValidationError` before any pass, naming it. A turbo `build` task that inlines a sibling's types needs `dependsOn: ["^build"]` in that package's own `turbo.json`, which no other package needs.
- **A subpath is matched exactly, as for a registry package.** `bundledPackages = ["@x/a"]` leaves an import of `@x/a/sub` in place, and listing `@x/a/sub` as well inlines it.
- **The dependency stays in the emitted manifest.** Only the declarations change, so the JS pass still imports it.

`exe` takes `fileName` (required), `entry` (`./src/bin.ts` when absent), `nodeVersion`, `seaConfig` and `targets` (inferred from the package's `os` and `cpu` when absent). The schema accepts a list, and the build accepts exactly one binary with one target.

Where the publish groups come from is not here: `package.json`'s `publishConfig.targets` decides them.

## `[package.bundle]`

The config tier of the emitted `bundle.json`, ranked over the package's and the root's source files (both named `bundle.json`; the bundler reads them with `loadBundleManifestSources` and fails `BundleManifestSourceError` on a present but invalid one; a source file still named `tsdoctor.json` is not read, and is reported as a `bundle-manifest-retired-source` warning). The old `[package.tsdoctor]` table fails the decode, and its error says it was renamed to `[package.bundle]`. Every key is optional: `name`, `tagline`, `description`, `openGraph` and `registries`. `registries = false` disables the default derived from `targets.json`. `openGraph` takes `images` (each with exactly one of `path` and `url`), `themeColor`, `generate` (`"satori"` is the only renderer) and `cacheSalt` (`false` always regenerates).[^build-config]

## `[action]`

**An absent `[action]` table means the package is not an action.** An empty one is a complete action config.[^action-config]

| Table | Key | Default | Meaning |
| --- | --- | --- | --- |
| `[action.entries]` | `main` | `src/main.ts` | The main entry's source |
| | `pre`, `post` | absent | Named sources must exist; absent, the conventional `src/pre.ts` and `src/post.ts` build when they exist |
| | `workers` | `{}` | A name to a source, or to a table of its own, each emitted as `dist/<name>.js` |
| `[action.build]` | `minify` | `true` | Minifies the bundles |
| | `sourceMap` | `false` | Generates source maps |
| | `externals` | `[]` | Left out and imported at runtime, beside `node:` builtins |
| | `ignore` | `[]` | Left out and replaced with a stub that throws if loaded |
| | `importCheck` | `true` | Imports each bundle in a fresh Node to prove it loads; turn it off for an action with no `GITHUB_ACTIONS` guard. `false` here turns it off for every bundle, whatever a worker's table says |
| `[action.validation]` | `requireActionYml` | `true` | `action.yml` must exist and be valid |
| | `maxBundleSize` | absent | The size past which a bundle is reported, such as `"5mb"` |
| | `strict` | absent | Whether a warning is an error; absent, it is under CI and is not locally |
| `[action.persistLocal]` | `enabled` | `true` | Copies the build locally |
| | `path` | `.github/actions/local` | The local action directory, relative to the package |
| | `actTemplate` | `true` | Generates `.actrc` and `act-test.yml` when they do not exist |

There is no key for keeping a package's dynamic imports native, and writing one fails like any unknown key.

**A worker that needs a setting is a table of its own.** `[action.entries.workers.<name>]` takes `source` (required) and `importCheck` (default `true`); a plain string is the same worker with every setting at its default, and the two forms mix in one action. A worker the action spawns with its configuration in the environment, and which refuses to start without it, sets `importCheck = false` in its own table: the load check then skips that bundle alone and still runs on `main`, `pre`, `post` and every other worker. `main`, `pre` and `post` have no table, because `action.yml` runs them and they are expected to sit behind a `GITHUB_ACTIONS` guard. An unknown key in a worker's table fails like any other.[^action-config]

```toml
[action.entries.workers]
changelog = "src/changelog.ts"

[action.entries.workers.turbo-server]
source = "src/turbo-server.ts"
importCheck = false   # exits at import without TURBOGHA_TOKEN, by design
```

## The two code keys

Everything else here is data. Code enters a build in exactly two places:

```toml
[package.build]
plugins = ["./lib/build/x.ts"]

[package.build.manifest]
drop = ["dependencies"]
```

- **`plugins`** lists modules, each resolved against the package directory, so a bare `build/plugin.ts` is a file rather than a package name. They load through `jiti`, so a `.ts` module works. A module's default export is a rolldown plugin or a factory of one, called once. Loading runs the module's code and stops at the first that fails, as `PluginLoadError`.[^plugins]
- **`manifest.drop` and `manifest.set`** drop top-level keys from the emitted `package.json`, beyond the ones always stripped, and write top-level string keys over it. Together they stand in for a free-form manifest transform, which has no counterpart.

[^build-config]: `packages/bundler/src/config/BuildConfig.ts`: every `[package]` key and default.
[^action-config]: `packages/bundler/src/config/ActionConfig.ts`: every `[action]` key and default.
[^config-file]: `packages/bundler/src/config/EffectedConfigFile.ts`: the candidates, the tiers, the strict decode and the blame.
[^merge]: `packages/bundler/src/config/merge.ts`: `ConfigMerge.deep` over the raw documents.
[^plugins]: `packages/bundler/src/config/plugins.ts`: the module contract and `PluginLoadError`.
[^manifest-set]: `packages/bundler/src/manifest/manifest-set.ts`: the protected keys and their reasons.
[^built-condition]: `packages/bundler/src/manifest/built-condition.ts`: the condition's checks, the strip and the target check.
[^runtime-e2e]: `packages/bundler/__test__/e2e/runtime-subdir.e2e.test.ts`: the runtime tree, the renamed manifest and plain-Node resolution through the condition, end to end.
