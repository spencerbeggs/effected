# @effected/bundler

The kit's build pipeline as a library: `Bundler.build` takes a package directory and a decoded config and writes `dist/prod`: the JS and declaration passes over tsdown, the emitted manifest, `targets.json`, the API Extractor meta bundle with its `bundle.json`, an optional SEA binary, and `issues.json`.

**Tier: integrated.** It imports tsdown, rolldown, `rolldown-plugin-dts`, `@microsoft/api-extractor` and `@tsdown/exe` at runtime, and peers `typescript`, as the tool's `cli`, `mcp` and `plugin` do. It is the only kit package that imports it. `satori` and `@resvg/resvg-js` are optional peers. The orchestrator's and the action builder's own IO go through core `FileSystem` and `Path` in `R`, so a real build needs the host's layers (`NodeServices.layer`): tsdown, rolldown, API Extractor and the SEA compiler always use the host disk. The tsdown and meta passes are still ported async code over `node:fs`, a recorded debt (`okf/modules/bundler.md`).

**For the full design:** → `@./okf/modules/bundler.md`

Load when changing the public API, a load-bearing output, or the seams.

`typescript` is peered as the literal `7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`, not `catalog:effected:build:peers`, because that catalog value pins a prerelease exactly and a plain lower bound would admit `-dev` nightlies; the plugin's `entry.test.ts` holds the four manifests to the same string.

## Module layout

- `Bundler.ts`: the orchestrator, `BundlerSeams`, `BundlerBuildResult`. `BundlerError.ts`: the failure, naming a `BundlerPhase` and carrying the collector's report.
- `config/`: the `effected.toml` schema, `EffectedConfigFile.load`, merge, plugin loading. `config-validation/`: the fast-fail `ConfigValidator`.
- `entries/`: entry points and export paths from `package.json`. `manifest/`: the emitted `package.json`. `catalog/`: `catalog:` and `workspace:` resolution.
- `targets/`: publish targets and `targets.json`.
- `passes/`, `dts/`, `tsconfig/`, `jsx/`: the tsdown passes, and the tsconfigs they run on.
- `meta/`: API Extractor, `generateMeta`, `runMetaPass`, composing and emitting `bundle.json` from its source tiers, Open Graph images. The `BundleManifest` schema itself lives in `@effected/manifest` (pure, `effect`-only), which `src/index.ts` re-exports name for name; never move it back, or a doc-site reader installs the toolchain (`@./okf/decisions/manifest-package.md`).
- `changesets/`: optimistic next versions through `@effected/changesets`.
- `exe/`: single-executable builds.
- `report/`: the collector and `issues.json`.
- `journal/`: `BuildJournal` and `IssueJournal`, the workspace root's `.cache/effected/*.jsonl`. `layerAt(root)` creates the directory and the file, because `Journal.append` refuses a missing file. A record derives from `issues.json`, and the engine writes it, not `Bundler.build`.
- `public/assets/`: the Open Graph card's font, copied to the package root.
- `action/`: GitHub Action builds. `ActionBuilder` orders `ActionValidation`, `ActionBundle` and `PersistLocal`; `ActionYml` is the schema of `action.yml`. `import-check.ts` is the post-build load check.

## Load-bearing outputs

Other tools read these, so a change to one moves with its readers. Paths are under the package:

| Output | Read by |
| --- | --- |
| `dist/prod/<group>/pkg` | the release action packs it; `PackedInstall` and the scratchpad's artifact mode; a consumer's `bundledPackages` naming this package, for `index.d.ts` |
| `dist/prod/<group>/meta` | tsdoctor, the release action, the construct generator |
| `dist/prod/targets.json` | the release action |
| `dist/prod/issues.json` | every gate. Check `buildOk` first, never `errors.length`: a crash can leave every bucket empty |
| `process.env.__PACKAGE_VERSION__` | the `define` that `packages/plugin` and `packages/cli` read |

`bundle.json` is a wire format with readers outside this repository. Its fields grow additively. A build deletes a leftover `tsdoctor.json`, the file's former name, from the meta dir and every `localPaths` copy, and never writes one.

`[package.build.meta] localPaths` copies the canonical group's model into directories relative to the package, for a consumer's docs site. The kit's own packages do not set it. `[package.build] copy` hands non-module assets to tsdown on the base partition's JS pass, once per group, with each `to` anchored to that group's `pkg/`; `public/` is the zero-config way. A directory `from` keeps its own basename under `to`: `copy = ["../../schemas"]` ships `pkg/schemas/...`, while `{ from = "../../schemas", to = "schemas" }` nests it as `pkg/schemas/schemas/...`. A manifest `exports` pattern matching no emitted file is a `warn`, code `exports-pattern-unmatched`, and so is a literal `exports` or `bin` target that is not a file, except the SEA's path. A `./dist/foo.js` export or bin is built from `./src/foo.ts` and published at the emitted name, and for an exe build `./dist/bin.js` names the exe source as `./src/bin.ts` does. A `*` over build sources, a `*` key over a literal build source, or a condition object naming the exe source fails `ConfigValidationError` before any pass. An `exports` `*` spans `/` (Node semantics), so a file at a deeper path than intended still satisfies the pattern and the warning cannot catch a wrongly nested copy.

`[package.build.manifest] set` writes top-level string keys over the emitted manifest; `set.name` is the base name of every group and of the API model, and `issues.json` keeps the source name. A source export's `effected-built` condition, a workspace-only route to `dist/prod/<group>/pkg` for plain-Node consumers, is validated and stripped in `runBuild` before any reader sees the exports, and again in `buildEmittedManifest`, which rereads `package.json` from disk. An `outSubdir` override is the per-file framework-runtime shape (`__test__/e2e/runtime-subdir.e2e.test.ts`).

An exe package's SEA compiles on any host, for its declared target: `@tsdown/exe` cross-compiles, and `--no-exe` is the only skip. Its manifest's `exports["."]` points at the binary, and it has a `bin` only when the source manifest declares one.

## Seams

`BundlerBuildOptions.seams` replaces any of `buildTargetGroups`, `runMetaPass`, `generateMeta`, `resolveNextVersions`, `importOgPeer`, `runExeBuild`, `writeIssues`, `readPackageJson`, `writeTsconfig`, `writeTargetsBinding` and `readTsconfigJsx`. Each defaults to the real one, but the seams keep their promise and sync types while several defaults now return an Effect (`writeIssues`, `readPackageJson`, `writeTargetsBinding`, `readTsconfigJsx`), so a test cannot pass the real function as a seam. A seam skips what it replaces, so the exe drift guard needs `vi.mock` rather than `runExeBuild`.

`runMetaPass` and `runExeBuild` load on first use. `runMetaPass` and `generateMeta` stay off the root as values, because a re-export would load API Extractor and its TypeScript on every import; `__test__/entrypoints.test.ts` pins that.

`ci` is an input, and it resolves an `"auto"` optimistic setting. Nothing here reads `process.env.CI` on that path. This module writes nothing to stdout: rendering belongs to the caller.

## Limits

- **`cwd` must be absolute.** The build resolves catalogs and workspaces from it and never from the process directory, but a relative `cwd` would resolve against the process. It is documented, not enforced.
- **`bundledPackages` naming a workspace sibling inlines its built declarations, so the sibling must be built first.** tsgo declares only the package's own project, so `dts/bundled-siblings.ts` finds the sibling through the realpath of its `node_modules` link and `writeDtsEmitTsconfig` gives that partition a `paths` map to the sibling's `dist/prod/<canonical group>/pkg`, the one case that writes `paths`. With no built `index.d.ts` the build fails `ConfigValidationError` before any pass. A consumer's turbo `build` task then needs `dependsOn: ["^build"]` in that package's own `turbo.json`. No kit package sets it.
- **A symlinked `cwd` fails the declaration pass** with `No TypeScript Go project found`, because tsgo keys its project by realpath. A shell's working directory is already canonical, so this reaches a caller passing a path such as macOS's `/var` temp directory. The e2es realpath theirs.
- **A sibling's source is accounted as suppressed.** API Extractor's diagnostics run follows a source link to a `.ts` file and reports `ae-wrong-input-file-type`. When the file's realpath lies outside the package or under its `node_modules`, that goes in the `suppressed` bucket through `isForeignInputFileMessage`, which is a classification rather than a `suppressWarnings` rule. Inside the package it stays a warning, since it means the package's own declarations reached its source. The suppression also hides a file reached through a tsconfig `paths` alias that resolves outside the package. API Extractor names only the first non-declaration file, so `runApiExtractor` also reads the program's file list (`ownSourceInputFiles`) and warns for every own source the message did not name.
- **A suppression rule with neither `messageId` nor `pattern` matches nothing**, though the schema accepts one.
- **`ActionBundle.build` runs what it builds.** Its load check imports each bundle in a fresh Node with only `HOME` and `TMPDIR` set, both a temporary directory it then removes, for at most a minute. An action's `GITHUB_ACTIONS` guard stays closed, but an action with no guard runs for real there, and with no `PATH`. `build.importCheck = false` turns the check off.

## Working here

```bash
pnpm exec vitest run --project @effected/bundler --coverage.enabled=false   # this package's tests
pnpm build --filter @effected/bundler                                       # through turbo, never the bin alone
```

Run vitest from the repository root, and read the exit code as well as the `Tests:` line. Three e2es are opt-in because they cost more, follow other packages or need another checkout:

```bash
EFFECTED_SPIKE=1 pnpm exec vitest run --project @effected/bundler --coverage.enabled=false kit-leaf   # cli-kit from source siblings
EFFECTED_PARITY=1 pnpm exec vitest run --project @effected/bundler --coverage.enabled=false parity    # jsonc against the previous bundler's bytes
EFFECTED_ACTION_SPIKE=/path/to/silk-release-action pnpm exec vitest run --project @effected/bundler --coverage.enabled=false action-spike   # rolldown on a real action
```

`EFFECTED_SPIKE_DIR` keeps the spike's scratch workspace somewhere to inspect, and `EFFECTED_ACTION_SPIKE_DIR` keeps the action spike's bundles and `report.json`. `__test__/e2e/exe-only.e2e.test.ts` runs by default and skips, saying why, on a host other than darwin-arm64 or when the Node runtime cannot be fetched.

`__test__/fixtures/parity/` holds verbatim bytes, and `biome.json` keeps the formatter off it. Its bytes follow jsonc's source and pending changesets, which is why that test is opt-in.

This package resolves its `@effected/*` dependencies through workspace links to their source, so no sibling needs a build first. Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*`, never `expect`. Port tests carry a one-line provenance header naming their source.
