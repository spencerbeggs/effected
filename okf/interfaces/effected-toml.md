---
type: Interface
title: "effected.toml: the build config's tables, defaults and discovery"
description: "The contract of effected.toml: every [package.build], [package.tsdoctor] and [action] key with its default, the two tiers it is discovered in and how they merge (objects per key, arrays and scalars replace), the strict single decode that fails an unknown key with its path, and the two keys through which code enters a build."
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
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T23:49:47Z
integrity:
  generated:
    body: 8eb38744f816e4c8
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
| `manifest` | `{ drop = [] }` | See [the two code keys](#the-two-code-keys) |
| `meta` | a table of defaults | The API model's settings, or `false` to opt out and still run the declaration pass |
| `exe` | absent | One single-executable binary to compile |

An override's `entries` is required and each must be a canonical export path, `"."` or `"./sub"`. It may set `format`, `bundle`, `externals`, `bundleNodeModules`, `bundledPackages`, `dtsExternals`, `platform` (`node` when absent, or `browser`, `neutral`), `css` and `outSubdir`. An unset key means the base build's value.[^build-config]

`[package.build.meta]`:

| Key | Default | Meaning |
| --- | --- | --- |
| `localPaths` | `[]` | Directories, relative to the package, that the canonical group's API model is copied into: the `.api.json`, the meta `package.json` and `tsconfig.json`, and `tsdoctor.json` when one was emitted. For a docs site that reads the model from its own tree |
| `optimistic` | `"auto"` | Forward-looks the meta bundle's versions from pending changesets. `auto` is `false` under CI and `true` locally |
| `tsdoc.suppressWarnings` | `[{ messageId = "ae-forgotten-export", pattern = "_base" }]` | API Extractor messages to suppress. A list **replaces** the default, so an empty one suppresses nothing |
| `tsdoc.tagDefinitions` | `[]` | Custom TSDoc tags: `{ tagName, syntaxKind, allowMultiple? }` |

### Non-module assets

A `public/` directory needs no config: its contents are copied verbatim into each group's `pkg/` root. `copy` is the explicit way, for files that live elsewhere, and is tsdown's `copy` option as data.

```toml
[package.build]
copy = ["../shared/schemas", { from = "assets/*.png", to = "img" }]
```

- **`from`, or a bare string, is a path or glob relative to the package directory.** A directory is copied whole under its own name, so `../shared/schemas` lands at `pkg/schemas`.
- **`to` is relative to the group's `pkg/` root**, where tsdown alone would read it against the package directory and put every group's copy in one place. One that leaves `pkg/` fails `ConfigValidationError`.
- **`flatten` defaults to `true`**, dropping each source's directories.
- **A package that only compiles a binary runs no JS pass,** so `copy` there fails `ConfigValidationError` rather than doing nothing.

An `exports` pattern such as `./schemas/*.json` that matches no file in the emitted package is a `warn` in `issues.json`, with `source: "config"` and code `exports-pattern-unmatched`. It does not fail the build.

### Inlining a workspace sibling

A sibling resolves to source, and the declaration pass cannot declare source outside its own project, so a `bundledPackages` entry that is a sibling inlines from **the sibling's built declarations**, as a registry package's would. An entry is a sibling when the realpath of `node_modules/<name>` lies inside the workspace root and outside any `node_modules`.

- **The sibling has to be built first.** With no `dist/prod/<canonical group>/pkg/index.d.ts`, the build fails `ConfigValidationError` before any pass, naming it. A turbo `build` task that inlines a sibling's types needs `dependsOn: ["^build"]` in that package's own `turbo.json`, which no other package needs.
- **A subpath is matched exactly, as for a registry package.** `bundledPackages = ["@x/a"]` leaves an import of `@x/a/sub` in place, and listing `@x/a/sub` as well inlines it.
- **The dependency stays in the emitted manifest.** Only the declarations change, so the JS pass still imports it.

`exe` takes `fileName` (required), `entry` (`./src/bin.ts` when absent), `nodeVersion`, `seaConfig` and `targets` (inferred from the package's `os` and `cpu` when absent). The schema accepts a list, and the build accepts exactly one binary with one target.

Where the publish groups come from is not here: `package.json`'s `publishConfig.targets` decides them.

## `[package.tsdoctor]`

The config tier of the emitted `tsdoctor.json`, ranked over the package's and the root's source files. Every key is optional: `name`, `tagline`, `description`, `openGraph` and `registries`. `registries = false` disables the default derived from `targets.json`. `openGraph` takes `images` (each with exactly one of `path` and `url`), `themeColor`, `generate` (`"satori"` is the only renderer) and `cacheSalt` (`false` always regenerates).[^build-config]

## `[action]`

**An absent `[action]` table means the package is not an action.** An empty one is a complete action config.[^action-config]

| Table | Key | Default | Meaning |
| --- | --- | --- | --- |
| `[action.entries]` | `main` | `src/main.ts` | The main entry's source |
| | `pre`, `post` | absent | Named sources must exist; absent, the conventional `src/pre.ts` and `src/post.ts` build when they exist |
| | `workers` | `{}` | A name to a source, each emitted as `dist/<name>.js` |
| `[action.build]` | `minify` | `true` | Minifies the bundles |
| | `sourceMap` | `false` | Generates source maps |
| | `externals` | `[]` | Left out and imported at runtime, beside `node:` builtins |
| | `ignore` | `[]` | Left out and replaced with a stub that throws if loaded |
| | `importCheck` | `true` | Imports each bundle in a fresh Node to prove it loads; turn it off for an action with no `GITHUB_ACTIONS` guard |
| `[action.validation]` | `requireActionYml` | `true` | `action.yml` must exist and be valid |
| | `maxBundleSize` | absent | The size past which a bundle is reported, such as `"5mb"` |
| | `strict` | absent | Whether a warning is an error; absent, it is under CI and is not locally |
| `[action.persistLocal]` | `enabled` | `true` | Copies the build locally |
| | `path` | `.github/actions/local` | The local action directory, relative to the package |
| | `actTemplate` | `true` | Generates `.actrc` and `act-test.yml` when they do not exist |

There is no key for keeping a package's dynamic imports native, and writing one fails like any unknown key.

## The two code keys

Everything else here is data. Code enters a build in exactly two places:

```toml
[package.build]
plugins = ["./lib/build/x.ts"]

[package.build.manifest]
drop = ["dependencies"]
```

- **`plugins`** lists modules, each resolved against the package directory, so a bare `build/plugin.ts` is a file rather than a package name. They load through `jiti`, so a `.ts` module works. A module's default export is a rolldown plugin or a factory of one, called once. Loading runs the module's code and stops at the first that fails, as `PluginLoadError`.[^plugins]
- **`manifest.drop`** lists top-level keys to drop from the emitted `package.json`, beyond the ones always stripped. It is what stands in for a free-form manifest transform.

[^build-config]: `packages/bundler/src/config/BuildConfig.ts`: every `[package]` key and default.
[^action-config]: `packages/bundler/src/config/ActionConfig.ts`: every `[action]` key and default.
[^config-file]: `packages/bundler/src/config/EffectedConfigFile.ts`: the candidates, the tiers, the strict decode and the blame.
[^merge]: `packages/bundler/src/config/merge.ts`: `ConfigMerge.deep` over the raw documents.
[^plugins]: `packages/bundler/src/config/plugins.ts`: the module contract and `PluginLoadError`.
