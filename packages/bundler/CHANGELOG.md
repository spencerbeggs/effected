# @effected/bundler

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/changesets | dependency | updated | 0.4.1 | 0.5.0 |
| @effected/config-file | dependency | updated | 0.27.1 | 0.27.1 |
| @effected/env | dependency | updated | 0.12.0 | 0.12.0 |
| @effected/files | dependency | updated | 0.3.0 | 0.3.0 |
| @effected/images | dependency | updated | 0.10.0 | 0.10.0 |
| @effected/jsonl | dependency | updated | 0.19.0 | 0.19.0 |
| @effected/npm | dependency | updated | 0.34.0 | 0.34.0 |
| @effected/package-json | dependency | updated | 0.32.1 | 0.32.1 |
| @effected/tsconfig-json | dependency | updated | 0.21.1 | 0.21.1 |
| @effected/walker | dependency | updated | 0.28.0 | 0.28.0 |
| @effected/workspaces | dependency | updated | 0.46.0 | 0.47.0 |

### Maintenance

- Pins every `@effected/*` dependency to the exact version the tool was built and tested with, so a newer kit patch never reaches an installed tool without a release of the tool. Each library's kit peers resolve from these pins, so a consumer's other kit versions no longer split the tool's graph.

## 0.4.0

### Breaking Changes

- The type of `ActionEntries.workers` widens from `Record<string, string>` to a record of `string | ActionWorker`. Code that reads a worker value as a string narrows it first.

### Features

#### A worker can be its own table

- `ActionEntries.workers` accepts a plain source string or an `ActionWorker`, so a worker can carry settings beside its source. The string form is unchanged.

```toml
[action.entries.workers]
plain = "src/plain.ts"

[action.entries.workers.guarded]
source = "src/guarded.ts"
importCheck = false
```

- `importCheck = false` skips the post-build load check for that worker alone, for one that exits at import by design. `[action.build] importCheck = false` still turns the check off for every bundle.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/changesets | dependency | updated | 0.4.0 | 0.4.1 |
| @effected/config-file | dependency | updated | 0.27.0 | 0.27.1 |
| @effected/npm | dependency | updated | 0.33.0 | 0.34.0 |
| @effected/package-json | dependency | updated | 0.32.0 | 0.32.1 |
| @effected/tsconfig-json | dependency | updated | 0.21.0 | 0.21.1 |
| @effected/walker | dependency | updated | 0.27.0 | 0.28.0 |
| @effected/workspaces | dependency | updated | 0.45.0 | 0.46.0 |

## 0.3.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/changesets | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/config-file | dependency | updated | 0.26.0 | 0.27.0 |
| @effected/env | dependency | updated | 0.11.0 | 0.12.0 |
| @effected/files | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/glob | dependency | updated | 0.20.0 | 0.21.0 |
| @effected/images | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/jsonc | dependency | updated | 0.24.0 | 0.25.0 |
| @effected/jsonl | dependency | updated | 0.18.1 | 0.19.0 |
| @effected/manifest | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/npm | dependency | updated | 0.32.1 | 0.33.0 |
| @effected/package-json | dependency | updated | 0.31.2 | 0.32.0 |
| @effected/semver | dependency | updated | 0.23.0 | 0.24.0 |
| @effected/toml | dependency | updated | 0.19.1 | 0.20.0 |
| @effected/tsconfig-json | dependency | updated | 0.20.2 | 0.21.0 |
| @effected/walker | dependency | updated | 0.26.0 | 0.27.0 |
| @effected/workspaces | dependency | updated | 0.44.2 | 0.45.0 |
| @effected/yaml | dependency | updated | 0.29.0 | 0.30.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.1

### Bug Fixes

- A CI build that fails its API Extractor pass on a forgotten export now writes the same diagnostics to `dist/prod/issues.json` as a local build of the same tree. Before, the artifact kept only the error-level entries, with no `file` or `line`, and dropped every warning.
  - The build still fails as before, with exit code 1, `buildOk: false` and `MetaGenerationError`.
  - The CI-fatal entries are listed in `errors` at error level, with their source locations.
  - In a package with several entry points, the entries after the failing one are reported too. [#1318][#1318]

* The declaration pass now picks its declarations-only option from the rolldown-plugin-dts copy tsdown will load: `dtsOnly` on 0.30 and later, `emitDtsOnly` below that. Builds on 0.30 no longer record the warning "The `emitDtsOnly` option is deprecated. Use `dtsOnly` instead." in `dist/prod/issues.json`, and builds still on 0.29, such as a workspace carrying silk's `tsdown>rolldown-plugin-dts` override, keep their declarations-only pass. No consumer action is needed.
* `DtsPassDtsOptions` now carries `dtsOnly` or `emitDtsOnly` as optional fields, exactly one of them set, instead of a fixed `emitDtsOnly`. `dtsPassDtsOptions()` takes an optional second argument naming the rolldown-plugin-dts version to target. [#1318][#1318]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/changesets | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/jsonl | dependency | updated | 0.18.0 | 0.18.1 |
| @effected/npm | dependency | updated | 0.32.0 | 0.32.1 |
| @effected/package-json | dependency | updated | 0.31.1 | 0.31.2 |
| @effected/semver | dependency | updated | 0.22.0 | 0.23.0 |
| @effected/workspaces | dependency | updated | 0.44.1 | 0.44.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1318]: https://github.com/spencerbeggs/effected/pull/1318

## 0.2.0

### Breaking Changes

#### The documentation sidecar is `bundle.json`

- The manifest the meta pass writes, and the source files it reads, are named `bundle.json` instead of `tsdoctor.json`. That covers the emitted `meta/bundle.json`, every `[package.build.meta] localPaths` copy, and the source files at the package root and the workspace root.

- A build deletes a leftover `tsdoctor.json` from `meta/` and from each `localPaths` copy, and never writes one

- A source file still named `tsdoctor.json` is not read. The build reports it as a `bundle-manifest-retired-source` warning and carries on

- `TSDOCTOR_MANIFEST_FILENAME` is removed. Use `BUNDLE_MANIFEST_FILENAME`

#### `[package.tsdoctor]` is `[package.bundle]`

- The `effected.toml` table is renamed, with the same keys. The old table fails the config decode, and the error says it was renamed to `[package.bundle]`.

#### The tsdoctor-named API takes Bundle names

- Renamed, with no aliases:

- `TsdoctorConfig`, `TsdoctorOpenGraphConfig`, `TsdoctorOpenGraphImage` and `TsdoctorRegistryRef` are `BundleConfig`, `BundleOpenGraphConfig`, `BundleOpenGraphImage` and `BundleRegistryRef`, and `PackageConfig.tsdoctor` is `PackageConfig.bundle`

- `TsdoctorEmitError` and `TsdoctorSourceError` are `BundleManifestEmitError` and `BundleManifestSourceError`, `_tag`s included

- `loadTsdoctorSources` and `TsdoctorSources` are `loadBundleManifestSources` and `BundleManifestSources`

- `TsdoctorMetaOptions` is `BundleMetaOptions`, and `composeTsdoctorManifest` is `composeBundleManifest`

- The `Bundler.build` option `tsdoctor` is `bundle`

- The meta pass's issue codes are `bundle-manifest-source-invalid`, `bundle-manifest-emit-failed` and `bundle-manifest-workspace-discovery-failed`

#### Migration

1. `git mv` each checked-in `tsdoctor.json` to `bundle.json`.
2. Rename `[package.tsdoctor]` to `[package.bundle]` in `effected.toml`.
3. Update imports of the renamed names, and any reader of `meta/tsdoctor.json` or of a `localPaths` copy.
4. A reader that only decodes the manifest can depend on `@effected/manifest` instead of the bundler.

#### The build takes `FileSystem` and `Path` from its context

- The build's own reads and writes go through core `FileSystem` and `Path`, which the caller now provides. tsdown, rolldown, API Extractor and the SEA compiler still use the host disk, so a real build needs the host's layers. A memory filesystem suits a build whose passes are all replaced through `seams`.

- `Bundler.build` and `ActionBundle.build` require `FileSystem.FileSystem | Path.Path` in `R`

- `ConfigValidator.layer` requires `FileSystem.FileSystem`

- `BuildJournal.layerAt`, `IssueJournal.layerAt` and `BuildJournal.record` also require `Path.Path`

- `writeIssuesArtifact`, `writeTargetsBinding` and `readTsconfigJsx` return an `Effect` instead of a value

- `removeDeclarationMaps` returns an `Effect` of `ReadonlyArray<string>`, failing with `DescendError` or `PlatformError`

- `BundlerSeams` is unchanged, and its members keep their promise and sync types

- Every output of a successful build is byte for byte what it was. When an IO step the build owns fails (writing `targets.json`, stripping declaration maps, reading the emitted package), the failure in `issues.json` and the `BundlerError` message now name a `PlatformError` or `DescendError`, with that error's message, instead of a Node `Error`. An export target nested under a file (`./index.js/sub`) is now an `exports-pattern-unmatched` warning, where it used to crash the build.

#### Migration

- Provide the host's layers where you call the build. Callers that go through `@effected/engine`'s `BuildRun` or `ActionRun` need no change. [#1310][#1310]

```ts
import { NodeServices } from "@effect/platform-node";
import { Bundler } from "@effected/bundler";
import type { BundlerBuildOptions } from "@effected/bundler";
import { Effect } from "effect";

declare const options: BundlerBuildOptions;

const result = Bundler.build(options).pipe(Effect.provide(NodeServices.layer));
```

### Features

#### Write string keys over the emitted `package.json`

- `[package.build.manifest] set` writes top-level string keys over the emitted manifest, after `drop`. `set.name` renames everything the build names: the publish groups, `targets.json` and the API model, so two workspace packages can emit as one published name.

```toml
[package.build.manifest]
set = { name = "@modules/versioned", description = "The v1 line" }
```

- Only keys `package.json` types as a string are written: `name`, `description`, `homepage`, `license`, and the string forms of `author`, `bugs`, `funding`, `repository`, `browser` and `man`
- Keys the build or the release owns, such as `version`, `private`, `exports` and the dependency maps, fail `ConfigValidationError` at `manifest.set.<key>`
- A renamed package publishes under the emitted name, while changesets, the CHANGELOG and the git tag keep the source name

#### The `effected-built` export condition

- A source export can name its built output under the `effected-built` condition, listed first. A plain-Node workspace consumer run with `--conditions=effected-built` then loads built JS, while vitest, tsx and TypeScript keep resolving source.

```json
"exports": {
  ".": { "effected-built": "./dist/prod/npm/pkg/index.js", "default": "./src/index.ts" }
}
```

- The build strips the condition, so it never reaches the published manifest
- It must be the first key, a literal path under `./dist/prod/`, followed by an `import` or `default` source condition. Anything else fails `ConfigValidationError`
- A target that is not the file a group emitted warns `exports-built-condition-unmatched`, naming the path to write
- `--conditions` reaches Node's resolver only. A bundler the consumer runs needs the condition in its own list, such as rspack's `resolve.conditionNames`

### Documentation

- An `outSubdir` override ships a framework runtime one file per source, with its own externals and `import.meta.env` left unresolved. That is the `@savvy-web/rspress-builder` `runtime: true` shape, and it is now covered end to end

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/changesets | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/npm | dependency | updated | 0.31.0 | 0.32.0 |
| @effected/package-json | dependency | updated | 0.31.0 | 0.31.1 |
| @effected/workspaces | dependency | updated | 0.44.0 | 0.44.1 |
| @effected/manifest | dependency | added | — | 0.1.0 |

- The manifest schema now comes from `@effected/manifest`. Every manifest name is still exported from the bundler's root as the same value. [#1310][#1310]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.1.0

### Features

- Adds `@effected/bundler`, the build behind the whole kit, replacing `@savvy-web/bundler` and `@savvy-web/github-action-builder`
- `Bundler.build` builds one package from its `effected.toml`: a JavaScript pass, a declaration pass, an API Extractor pass for the meta output, the SEA executable compile, and the build journals; the outputs land in `dist/prod`
- `ActionBuilder.build` bundles a GitHub Action from the `[action]` table of its `effected.toml` on rolldown, with `ActionValidation` and `PersistLocal` as separate steps
- Takes over the `tsdoctor.json` schema from `@tsdoctor/manifest`
- Emitted artifacts for the kit's packages are byte-identical to the previous bundler's output
- Adds `[package.build] copy` for shipping non-module assets in each publish group's `pkg/`, in the shape of tsdown's `copy` option, beside the zero-config `public/` directory; a directory `from` keeps its own basename under `to`, so `copy = ["../../schemas"]` ships `pkg/schemas/...` while `{ from = "../../schemas", to = "schemas" }` nests it as `pkg/schemas/schemas/...`
- Adds `[package.build.meta] localPaths` for copying the canonical group's API model into a directory a docs site reads
- Warns with `exports-pattern-unmatched` in `issues.json` when a manifest `exports` pattern matches no emitted file (an exports `*` spans `/`, so a wrongly nested copy still satisfies it)
- A subpath export written as a condition object whose `import`, `default` and `types` conditions all name one TypeScript source is published under its export key, like the bare-string form; any other condition object holding a TypeScript source fails `ConfigValidationError` before any pass, instead of a manifest that points at a file the build never writes

* A literal `./dist/foo.js` export or `bin` target, including an executable entry, points at the emitted file
* A literal export or `bin` target that names no emitted file warns `exports-pattern-unmatched`
* Every own source file in the declaration program is reported

### Bug Fixes

- `bundledPackages` naming a workspace sibling now inlines the sibling's built declarations, as it does a registry package's, instead of failing with `tsgo did not generate a declaration file`; an unbuilt sibling fails `ConfigValidationError` before any pass, naming it and the `dependsOn: ["^build"]` its consumer needs [#1249][#1249]

* A `*` pattern over build sources, a `*` key over a literal build source, and a condition object naming the executable fail with `ConfigValidationError` instead of producing a wrong manifest [#1295][#1295]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/changesets | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/config-file | dependency | updated | 0.25.0 | 0.26.0 |
| @effected/files | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/glob | dependency | updated | 0.19.0 | 0.20.0 |
| @effected/npm | dependency | updated | 0.30.1 | 0.31.0 |
| @effected/package-json | dependency | updated | 0.30.0 | 0.31.0 |
| @effected/tsconfig-json | dependency | updated | 0.20.1 | 0.20.2 |
| @effected/walker | dependency | updated | 0.25.1 | 0.26.0 |
| @effected/workspaces | dependency | updated | 0.43.0 | 0.44.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

[#1295]: https://github.com/spencerbeggs/effected/pull/1295
