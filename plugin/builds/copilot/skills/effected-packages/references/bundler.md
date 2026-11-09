# @effected/bundler

The kit's build pipeline as a library: the code behind `effected package build` and `effected action build`. `Bundler.build` takes a package directory and a decoded config and writes `dist/prod`: the JS and declaration passes, the emitted `package.json`, `targets.json`, the API Extractor meta bundle with its `bundle.json`, an optional single-executable binary, and `issues.json`. `ActionBuilder.build` validates, bundles and persists a GitHub Action. Integrated tier: it carries tsdown, rolldown, API Extractor and `@tsdown/exe` at runtime and peers `typescript` (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`). A consumer builds with the commands from `@effected/plugin`; import this package only to embed or test the pipeline.

## Import

```ts
import { ActionBuilder, Bundler, BuildJournal, BundleManifest, EffectedConfigFile } from "@effected/bundler";
```

## Core API

- **`Bundler.build({ cwd, config, bundle, noExe, verbose, plugins, ci, seams? })`** — builds the package at an absolute `cwd`. It succeeds with a `BundlerBuildResult` (`report`, `issuesPath`, `targetsPath`) and fails `BundlerError` (naming a `BundlerPhase`, carrying the collector's report) or `ConfigValidationError` before any work. Both failures write `issues.json` stamped `buildOk: false` first. It writes nothing to stdout; rendering is the caller's.
- **`EffectedConfigFile.load`** — reads and merges the `effected.toml` files into a `ResolvedEffectedConfig`. Discovery runs `<root>/.config/effected.toml`, `<root>/effected.toml`, `<pkg>/.config/effected.toml`, `<pkg>/effected.toml`, `<pkg>/lib/configs/effected.toml`; later wins, and root defaults merge under the package (objects per key, arrays replace). `EffectedConfigError` is its failure; `PluginLoadError` is a `plugins` module that would not load.
- **`PackageBuildConfig`** — the `[package.build]` table: `format`, `externals`, `bundle`, `bundledPackages`, `dtsExternals`, `bundleNodeModules`, `minify`, `emitDts`, `define`, `plugins`, `overrides`, `looseFiles`, `copy` (a path or `CopyEntry`, `{ from, to?, flatten? }`), `jsx`, `manifest.drop`, `meta` (`localPaths`, `optimistic`, `tsdoc.suppressWarnings`, `tsdoc.tagDefinitions`) and `exe`. `BundleConfig` is `[package.bundle]`.
- **`ActionBuilder.build({ config, cwd, validate, ... })`** — orders `ActionValidation`, `ActionBundle` and `PersistLocal` from an `ActionConfig` (`entries`, `build`, `validation`, `persistLocal`), with `FileSystem` and `Path` in `R`. A failing step stops the ones after it, so an invalid action leaves `dist` as it was. It fails `ValidationFailed` or `BuildFailed`. Bundling always touches the real disk because rolldown does.
- **`ActionBundle.build`** — one self-contained ESM file per entry at `dist/<entry>.js`, then a load check that imports each bundle in a fresh Node in an isolated temporary directory with no `PATH`. `build.importCheck = false` turns the check off. `build.ignore` aliases a package to a throwing stub. A computed `import()` stays native.
- **`BundleManifest`** — the schema of the emitted `bundle.json` (`decodeBundleManifest`, `encodeBundleManifest`, `BUNDLE_MANIFEST_FILENAME`), re-exported from the pure [`@effected/manifest`](./manifest.md); a reader that only decodes the file depends on that package instead. It is a wire format with readers outside the repository; fields grow additively. A build deletes a leftover `tsdoctor.json`, the former name, and never writes one.
- **`BuildJournal` and `IssueJournal`** — the workspace root's `.cache/effected/build.jsonl` and `issues.jsonl`, over `@effected/jsonl`; `layerAt(root)` creates the directory and the file.

## Outputs other tools read

Under the package: `dist/prod/<group>/pkg` (the publishable tree), `dist/prod/<group>/meta` (the API model), `dist/prod/targets.json` and `dist/prod/issues.json`. **Read `issues.json`'s `buildOk` first**, never `errors.length`: a crash can leave every bucket empty. A turbo cache hit replays the previous run's log verbatim, so a clean log does not prove a build ran; `issues.json`'s `generatedAt` must postdate your last source edit.

## Testing

`BundlerBuildOptions.seams` replaces any phase (`buildTargetGroups`, `runMetaPass`, `generateMeta`, `resolveNextVersions`, `runExeBuild`, `writeIssues`, and others); a seam skips what it replaces. `ActionValidation` and `PersistLocal` take `@effected/memfs`; `ActionBuilder.build` and `Bundler.build` need the real disk.

## Gotchas

- `cwd` must be absolute; a relative one resolves against the process directory.
- `bundledPackages` naming a workspace sibling inlines the sibling's **built** declarations, so build it first: with no `dist/prod/<canonical group>/pkg/index.d.ts` the build fails `ConfigValidationError` before any pass, and a turbo `build` task that inlines a sibling's types needs `dependsOn: ["^build"]` in that package's own `turbo.json`. A subpath inlines only when listed, as for a registry package.
- A `./schemas/*.json` export needs files behind it: `public/` is copied verbatim with no config, and `copy` is the explicit way, each `to` relative to the group's `pkg/`. A directory `from` keeps its own basename under `to`: `copy = ["../../schemas"]` ships `pkg/schemas/...`, while `{ from = "../../schemas", to = "schemas" }` nests it as `pkg/schemas/schemas/...`. A pattern matching nothing in the emitted package is a `warn` in `issues.json`, code `exports-pattern-unmatched`, and so is a literal `exports` or `bin` target that is not a file there. An `exports` `*` spans `/` (Node semantics), so a file at a deeper path than intended still satisfies the pattern and the warning cannot catch a wrongly nested copy.
- An export written as the built path, `./dist/foo.js`, is built from `./src/foo.ts` and published pointing at the emitted `./foo.js`. A `*` over build sources (`./dist/*.js`, `./src/*.ts`) or a `*` key over one literal source fails `ConfigValidationError` before any pass, as does a condition object naming an exe's entry source: export that source, as `./src/bin.ts` or `./dist/bin.js`, as a bare string and it points at the binary.
- An exe package's binary compiles on any host for its declared target, and `--no-exe` is the only skip. Its `exports["."]` points at the binary, and it has a `bin` only when the source manifest declares one.
- A suppression rule with neither `messageId` nor `pattern` matches nothing, though the schema accepts it.
- A bin-only package (`exports` limited to `"./package.json"`) needs `emitDts = false`, or the meta pass fails `Cannot merge zero API models`.
- `runMetaPass` and `generateMeta` stay off the root as values so importing the package does not load API Extractor.
- The load check runs an action that has no `GITHUB_ACTIONS` guard for real.
