# effected.toml: every package key

`effected package build` reads `effected.toml`. Every key has a default or may be absent, so no file is a complete config. The authority is `@effected/bundler`'s `EffectedConfig`, `PackageConfig`, `PackageBuildConfig`, `MetaConfig`, `TsdocConfig` and `BundleConfig` in its installed `index.d.ts`. The `[action]` tables belong to `effected action build`; see `building-a-github-action`.

## Discovery and merge

| Tier | Candidates, first found wins | Applies |
| --- | --- | --- |
| Root | `.config/effected.toml`, `effected.toml` | under the workspace root, which is the package directory when no root sits above it |
| Package | `.config/effected.toml`, `effected.toml`, `lib/configs/effected.toml` | under the package directory, when it is not the root |

- **Within a tier, only the first file found is read.** A `lib/configs/effected.toml` is ignored when the package also has an `effected.toml`.
- **Across tiers, the package merges over the root** on the raw documents, before decoding. Tables merge per key. An array or a scalar replaces the root's value whole, so a package's `externals` does not add to the root's.
- **A table the root writes reaches every package under it.** A root `[action]` table makes every package an action to `effected action build`.

## Decoding and refusals

The merged document decodes once and strictly: every issue is reported at once, as `EffectedConfigError`, naming the file and each issue's dotted path. An unknown key fails; nothing is ignored.

Some rules no schema can state are checked after decoding and before any build work, failing `ConfigValidationError`:

- an `exe` with more than one binary or target, an empty `fileName`, or no targets when the package declares no `os`/`cpu`;
- an `outSubdir` override pinning more than one export, or an override naming a path that is not an export;
- a `copy` destination leaving `pkg/`, or any `copy` in a package that compiles only a binary;
- a `meta` table in a package with no `exports` map;
- a `bundledPackages` sibling with no built `index.d.ts`;
- a `manifest.set` key the build or the release owns;
- an export pattern over build sources, or a misplaced `effected-built` condition (see [outputs.md](outputs.md) and [workspace-wiring.md](workspace-wiring.md)).

## `[package.build]`

| Key | Default | Meaning |
| --- | --- | --- |
| `format` | `["esm"]` | Output module formats, `"esm"` and `"cjs"`. Add `"cjs"` for a dual-format build |
| `externals` | `[]` | Packages kept external |
| `bundle` | `[]` | Packages force-bundled into the JS output, even declared ones. Declarations are not inlined by this |
| `bundledPackages` | `[]` | External packages whose declarations are inlined into the bundled `.d.ts`. A workspace sibling inlines from its build |
| `dtsExternals` | `[]` | Packages externalized in the declaration pass only, kept as imports in the `.d.ts` while the JS still bundles them. Declare them as dependencies so consumers resolve the imports |
| `bundleNodeModules` | `false` | Bundles non-external `node_modules` and workspace dependencies into the JS and the declarations |
| `minify` | `false` | Minifies the output. Off because minified Node libraries trip scanners and lose stack traces |
| `emitDts` | `true` | Runs the declaration pass and, with it, the meta pass |
| `define` | `{}` | Compile-time replacements, inserted verbatim, so a string value carries its own quotes |
| `plugins` | `[]` | Module paths whose default export is a rolldown plugin or a factory of one |
| `overrides` | `[]` | `[[package.build.overrides]]`: settings pinned to some export paths |
| `looseFiles` | `{}` | Standalone files at literal output paths: a source path or `{ source, format? }` |
| `copy` | `[]` | Non-module assets copied into each group's `pkg/`: a path or glob, or `{ from, to?, flatten? }` |
| `jsx` | inferred from the tsconfig | `{ runtime?, importSource? }`, `runtime` `"automatic"` or `"classic"` |
| `manifest` | `{ drop = [], set = {} }` | Top-level keys dropped from, and string keys written over, the emitted `package.json` |
| `meta` | a table of defaults | The API model's settings, or `false` to skip the model and still run the declaration pass |
| `exe` | absent | One single-executable binary |

`process.env.__PACKAGE_VERSION__` is always defined to the package's version; a `define` key of the same name wins. `@effected/plugin/env` declares it for TypeScript (`/// <reference types="@effected/plugin/env" />`).

### Choosing a bundling key

| Key | JS bundled | Declarations inlined | Reach for it when |
| --- | --- | --- | --- |
| `externals` | no | no | a dependency must stay a runtime import in both outputs |
| `bundle` | yes | no | the JS should inline a package whose types can stay referenced |
| `bundledPackages` | as the JS | yes | a dependency's types must appear in your `.d.ts` |
| `dtsExternals` | yes | no, kept as an import | the JS inlines it but its types cannot be inlined safely, such as `effect`'s `declare module` augmentations, or a subpath naming the root's types through the package's own name |
| `bundleNodeModules` | everything not external | tracks the JS | a fully self-contained artifact |

### `[[package.build.overrides]]`

| Key | Meaning |
| --- | --- |
| `entries` | Required. Canonical export paths, `"."` or `"./sub"` |
| `format`, `bundle`, `externals`, `bundleNodeModules`, `bundledPackages`, `dtsExternals` | As the base keys, for this partition only |
| `platform` | `"node"` when absent, or `"browser"`, `"neutral"` |
| `css` | Forwarded to tsdown's `css` option on the JS pass; needs `@tsdown/css` installed |
| `outSubdir` | Builds the one export as a sub-package under `pkg/<outSubdir>/`, one file per source |

An unset override key means the base build's value. [outputs.md](outputs.md) covers `outSubdir`.

### `[package.build.exe]`

| Key | Default | Meaning |
| --- | --- | --- |
| `fileName` | required | The binary's basename, with no extension |
| `entry` | `./src/bin.ts` | The bin entry |
| `nodeVersion` | the bundler's `DEFAULT_EXE_NODE_VERSION` | The Node runtime embedded |
| `seaConfig` | defaults | `disableExperimentalSEAWarning`, `useCodeCache`, `useSnapshot` |
| `targets` | inferred from `os` and `cpu` | `[{ platform, arch }]`, `platform` `"darwin"`, `"linux"` or `"win"`, `arch` `"arm64"` or `"x64"` |

The schema accepts a list, and the build accepts exactly one binary with one target.

## `[package.build.meta]`

| Key | Default | Meaning |
| --- | --- | --- |
| `localPaths` | `[]` | Directories, relative to the package, that the canonical group's API model is copied into, for a docs site reading it from its own tree |
| `optimistic` | `"auto"` | Forward-looks the meta bundle's versions from pending changesets. `"auto"` is `false` under CI and `true` locally |
| `tsdoc.suppressWarnings` | `[{ messageId = "ae-forgotten-export", pattern = "_base" }]` | API Extractor messages to suppress. A list **replaces** the default, so an empty list suppresses nothing |
| `tsdoc.tagDefinitions` | `[]` | Custom TSDoc tags: `{ tagName, syntaxKind, allowMultiple? }` |

`meta = false` skips the model and keeps the declaration pass. `emitDts = false` skips both, which is what a bin-only package (`exports` limited to `"./package.json"`) needs: otherwise the meta pass fails `Cannot merge zero API models`.

```toml
# Bin-only: no declarations to bundle, no API model to extract.
[package.build]
emitDts = false
```

### `suppressWarnings` and `tagDefinitions`

```toml
[package.build.meta.tsdoc]
suppressWarnings = [
  { messageId = "ae-forgotten-export", pattern = "_base" },   # restate the default: a list replaces it
]
tagDefinitions = [{ tagName = "@since", syntaxKind = "block" }]
```

- A rule's `messageId` matches the message id exactly. Its `pattern` is compiled as a regular expression and tested against the message text, and is used as a plain substring only when it is not a valid one. A rule with both needs both.
- A rule with only `messageId` suppresses every message with that id. A rule with only `pattern` matches across every id. A rule with neither matches nothing.
- A suppressed message lands in `issues.json`'s `suppressed` bucket and cannot fail CI.
- `syntaxKind` is `"block"`, `"inline"` or `"modifier"`. A registered tag joins the supported set, so it no longer raises `tsdoc-undefined-tag`.

When to write either is a TSDoc decision: `authoring-tsdoc` owns it.

## `[package.bundle]`

The config tier of the emitted `bundle.json`, ranked over `bundle.json` source files in the package and at the root. Every key is optional:

| Key | Meaning |
| --- | --- |
| `name`, `tagline`, `description` | Display strings |
| `openGraph` | `images` (each exactly one of `path` and `url`, plus `type`, `width`, `height`, `alt`), `themeColor`, `generate` (`"satori"` is the only renderer), `cacheSalt` (`false` always regenerates) |
| `registries` | A list of `{ type, name, url }`, or `false` to disable the default derived from `targets.json` |

A `[package.tsdoctor]` table fails the decode with a message saying it is now `[package.bundle]`, and a source file still named `tsdoctor.json` is not read: the build reports it as a `bundle-manifest-retired-source` warning.
