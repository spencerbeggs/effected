# @effected/bundler

The kit's build pipeline as a library: `Bundler.build` takes a package directory and a decoded config and writes `dist/prod`: the JS and declaration passes over tsdown, the emitted manifest, `targets.json`, the API Extractor meta bundle with its `tsdoctor.json`, an optional SEA binary, and `issues.json`.

**Tier: integrated.** It imports tsdown, rolldown, `rolldown-plugin-dts`, `@microsoft/api-extractor` and `@tsdown/exe` at runtime, and peers `typescript` (the only kit package that does). `satori` and `@resvg/resvg-js` are optional peers. The internals are ported plain async code over `node:fs`; only the public boundary is Effect with typed failures, a recorded debt.

**For the full design:** → `@./okf/modules/bundler.md`

Load when changing the public API, a load-bearing output, or the seams.

`typescript` is peered as the literal `7.1.0-beta || 7.1.0-rc || >=7.1.0 <8`, not `catalog:build:peers`, because that catalog value pins a prerelease exactly and a plain lower bound would admit `-dev` nightlies; the plugin's `entry.test.ts` holds the four manifests to the same string.

## Module layout

- `Bundler.ts`: the orchestrator, `BundlerSeams`, `BundlerBuildResult`. `BundlerError.ts`: the failure, naming a `BundlerPhase` and carrying the collector's report.
- `config/`: the `effected.toml` schema, `EffectedConfigFile.load`, merge, plugin loading. `config-validation/`: the fast-fail `ConfigValidator`.
- `entries/`: entry points and export paths from `package.json`. `manifest/`: the emitted `package.json`. `catalog/`: `catalog:` and `workspace:` resolution.
- `targets/`: publish targets and `targets.json`.
- `passes/`, `dts/`, `tsconfig/`, `jsx/`: the tsdown passes, and the tsconfigs they run on.
- `meta/`: API Extractor, `generateMeta`, `runMetaPass`, the `BundleManifest` schema of `tsdoctor.json`, its source tiers, Open Graph images.
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
| `dist/prod/<group>/pkg` | the release action packs it; `PackedInstall` and the scratchpad's artifact mode |
| `dist/prod/<group>/meta` | tsdoctor, the release action, the construct generator |
| `dist/prod/targets.json` | the release action |
| `dist/prod/issues.json` | every gate. Check `buildOk` first, never `errors.length`: a crash can leave every bucket empty |
| `process.env.__PACKAGE_VERSION__` | the `define` that `packages/plugin` and `packages/cli` read |

`tsdoctor.json` is a wire format with readers outside this repository. Its fields grow additively.

## Seams

`BundlerBuildOptions.seams` replaces any of `buildTargetGroups`, `runMetaPass`, `generateMeta`, `resolveNextVersions`, `importOgPeer`, `runExeBuild`, `writeIssues`, `readPackageJson`, `writeTsconfig`, `writeTargetsBinding` and `readTsconfigJsx`. Each defaults to the real one. A seam skips what it replaces, so the exe drift guard needs `vi.mock` rather than `runExeBuild`.

`runMetaPass` and `runExeBuild` load on first use. `runMetaPass` and `generateMeta` stay off the root as values, because a re-export would load API Extractor and its TypeScript on every import; `__test__/entrypoints.test.ts` pins that.

`ci` is an input, and it resolves an `"auto"` optimistic setting. Nothing here reads `process.env.CI` on that path. This module writes nothing to stdout: rendering belongs to the caller.

## Limits

- **`cwd` must be absolute.** The build resolves catalogs and workspaces from it and never from the process directory, but a relative `cwd` would resolve against the process. It is documented, not enforced.
- **`bundledPackages` naming a sibling that resolves to source fails the build** with `tsgo did not generate a declaration file`, because tsgo declares only the package's own project. No kit package sets it.
- **A sibling's source is accounted as suppressed.** API Extractor's diagnostics run follows a source link to a `.ts` file and reports `ae-wrong-input-file-type`. When the file's realpath lies outside the package, that goes in the `suppressed` bucket through `isForeignInputFileMessage`, which is a classification rather than a `suppressWarnings` rule. Inside the package it stays a warning, since it means the package's own declarations reached its source.
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
