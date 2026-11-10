---
name: building-a-package
description: Use when building a library package with the effected kit, through `effected package build` and its optional `effected.toml`, or when reading what a build left in `dist/prod`. Covers every `[package.build]`, `[package.build.meta]` and `[package.bundle]` key, publish groups from `publishConfig.targets`, `copy`, `plugins`, `looseFiles`, `overrides` with `outSubdir`, `exe`, manifest `drop`/`set`, the workspace wiring (links to `src/`, `nodeOptions` tsx, self-registering bins, built-bin tests, the `effected-built` condition), and reading `dist/prod/issues.json` with `buildOk` first.
when_to_use: effected package build, effected.toml, package_build MCP tool, configure the build, dual-format esm cjs, externals vs bundle vs bundledPackages vs dtsExternals, bundle a dependency, copy assets into the package, schemas/*.json export matches nothing, exports-pattern-unmatched, rolldown plugin in the build, looseFiles, pnpmfile.mjs, single executable, SEA binary, --no-exe, rename the published package, manifest set name, drop devDependencies, publishConfig.targets, publish to npm and GitHub Packages, dist/prod layout, targets.json, issues.json, buildOk, ciFatal, generatedAt, build log looks clean, turbo cache hit, links resolve to src, nodeOptions --import=tsx, effected-built condition, rspress build cannot load workspace plugin, framework runtime one file per source, outSubdir, Cannot merge zero API models, ConfigValidationError, EffectedConfigError
---

# Building a package with the effected kit

A library package builds with `effected package build`, the command from `@effected/plugin` (the root devDependency that also brings `effected-mcp`). It reads an optional `effected.toml`, builds the package in the working directory and writes everything under `dist/prod`. There is one build target, no dev build, no `prepare` and no target flag. Most packages need no `effected.toml` at all: every key has a default, so no file is a complete config.

The authority for every key is `PackageBuildConfig` (the `[package.build]` table) and its siblings in `@effected/bundler`'s published declarations. Read the installed `index.d.ts` when a shape matters; this skill restates it, the `.d.ts` decides.

| Construct | Where it lives | Reach for it when |
| --- | --- | --- |
| `effected package build [--format=human\|json] [--no-exe] [--verbose]` | `@effected/plugin` bin | building one package from its own directory |
| `package_build` MCP tool (`cwd?`, `noExe?`) | `effected-mcp` | an agent building without a shell; same result as data, builds serialized |
| `"build": "effected package build"` + turbo `build` with `dependsOn: ["types:check"]` | the package's `package.json` and `turbo.json` | the normal route: turbo holds the typecheck gate and the cache |
| `[package.build]` | `effected.toml` | formats, externals and bundling, `copy`, `plugins`, `overrides`, `looseFiles`, `exe`, `manifest` |
| `[package.build.meta]`, `[package.build.meta.tsdoc]` | `effected.toml` | the API model: `localPaths`, `optimistic`, `suppressWarnings`, `tagDefinitions` |
| `[package.bundle]` | `effected.toml` | the emitted `bundle.json`: `name`, `tagline`, `description`, `openGraph`, `registries` |
| `publishConfig.targets` | `package.json` | publishing more than one name or registry: it decides the publish groups |
| `dist/prod/issues.json` | the build's output | deciding whether the build passed, and what it reported |
| `effected action build` and `[action]` | `effected.toml` | a GitHub Action, not a library: see `building-a-github-action` |

## Standards

- **Run the build through the package's turbo `build` task** (`pnpm build --filter <pkg>` or `pnpm turbo run build --filter <pkg>`). A direct `effected package build` in the package directory is allowed, but it skips the typecheck gate and the cache. The MCP `package_build` tool runs the build itself and no typecheck either.
- **Write only the keys you change.** The merged document decodes once, strictly, so an unknown or misspelled key fails `EffectedConfigError` naming its dotted path (`package.build.formats`) instead of taking a default silently.
- **Put the file where discovery finds it.** Root tier: `.config/effected.toml`, then `effected.toml`. Package tier: `.config/effected.toml`, then `effected.toml`, then `lib/configs/effected.toml`. Within a tier the first file found is the only one read; the package tier merges over the root, tables per key, while an array or a scalar replaces the root's value whole.
- **Declare publish groups in `package.json`, not in `effected.toml`.** `publishConfig.targets` decides them; with none there is one group, `npm`.
- **Keep code in the two code keys.** `plugins` (module paths) and `manifest.drop`/`manifest.set` are the only ways code or manifest edits enter a build; everything else is data.
- **Read `issues.json`'s `buildOk` before any bucket**, then `ciFatal`, then the warnings. Check that the command did not exit 2 (a refused run may write none) and that `generatedAt` postdates your last source edit before trusting any of it.
- **Hand API Extractor diagnostics to the TSDoc skills.** `ae-*` and `tsdoc-*` codes are fixed in doc comments and the export surface, never with a new suppression: `authoring-tsdoc` owns the policy, `effect-api-extractor-bases` the class-factory `_base` rule and `{@link}` selectors, and the `tsdoc-fixer` agent the end-to-end fix loop.

## What CI changes

`effected package build` reads `CI` from the environment, and an agent in GitHub Actions, a cloud coding agent or any shell with `CI` set builds as CI does. Under CI an `ae-forgotten-export` is an error that fails the API Extractor pass, so the build ends `buildOk: false` with `failure.name` `MetaGenerationError`, and the artifact still lists every warning and every location a local build lists, with the CI-fatal entries in `errors` at error level instead of `warnings` marked `ciFatal: true`. A CI build writes no API model and fails the run, so build as local when you need the build to finish; locally, treat a `ciFatal: true` warning as the CI failure. Detection is `@effected/env`'s rule: `CI` or `CONTINUOUS_INTEGRATION` set to a value other than empty, `false`, `0`, `off` or `no`, or any CI provider's marker set the same way, whatever `CI` says. The markers are the provider table's detection variables, about forty of them, such as `GITHUB_ACTIONS`, `GITLAB_CI`, `CI_MERGE_REQUEST_ID`, `BUILDKITE`, `CIRCLECI`, `JENKINS_URL`, `TRAVIS`, `TEAMCITY_VERSION`, `CODEBUILD_BUILD_ARN` and `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI`. No flag forces a local build, so to build as local, unset or set to `false` every one of them that is set, `CI` and `CONTINUOUS_INTEGRATION` included: `CI=` is enough on a plain shell, and inside GitHub Actions it takes `CI=false GITHUB_ACTIONS=false effected package build`, run in the package directory after its typecheck. On another provider, find what is set with `env`, and clear that provider's marker too. The `package_build` MCP tool takes its CI answer from the environment `effected-mcp` was launched in, so inside CI it builds as CI. `meta.optimistic = "auto"` also resolves to `false` under CI.

## Footguns

- A turbo cache hit replays a clean log verbatim and restores `issues.json` with it; `generatedAt`, not the log or the file's mtime, says whether a build ran → [reading-issues.md](references/reading-issues.md).
- A crashed build can leave every bucket empty, identical to a clean gate; only `buildOk` tells them apart → [reading-issues.md](references/reading-issues.md).
- A `suppressWarnings` list replaces the default `_base` rule rather than adding to it → [effected-toml.md](references/effected-toml.md).
- `copy = [{ from = "../../schemas", to = "schemas" }]` nests as `pkg/schemas/schemas/...`; a directory keeps its own basename → [outputs.md](references/outputs.md).
- `bundledPackages` naming a workspace sibling inlines its **built** declarations, so the sibling builds first (`dependsOn: ["^build"]`) → [outputs.md](references/outputs.md).
- An `exe` package accepts exactly one binary with one target → [outputs.md](references/outputs.md).
- A bin-only package (`exports` is only `"./package.json"`) fails `Cannot merge zero API models` until it sets `emitDts = false` → [effected-toml.md](references/effected-toml.md).
- `nodeOptions: --import=tsx` reaches every process a pnpm script starts, and a tool that loads its own bundles (`rspress build`) can break under it → [workspace-wiring.md](references/workspace-wiring.md).
- A built bin spawned inside a linked workspace still imports siblings from source, so its test passes `--import <tsx file URL>` → [workspace-wiring.md](references/workspace-wiring.md).

## Additional resources

- [references/effected-toml.md](references/effected-toml.md) — every `[package.build]`, `[package.build.meta]` and `[package.bundle]` key with its default, discovery and merge, and the refusals before any pass. Load when: writing or reviewing an `effected.toml`, or reading an `EffectedConfigError` or `ConfigValidationError`.
- [references/targets-and-groups.md](references/targets-and-groups.md) — `publishConfig.targets`, how targets collapse into publish groups, `dist/prod/<group>/{pkg,meta}` and `targets.json`. Load when: publishing to more than one registry or under more than one name, or reading `targets.json`.
- [references/outputs.md](references/outputs.md) — `copy`, `plugins`, `looseFiles`, `overrides` with `outSubdir`, `exe`, manifest `drop`/`set`, `bundledPackages` from a sibling, and literal `exports` rewriting. Load when: shipping assets, adding a rolldown plugin, emitting a standalone file, building a framework runtime, a single-executable binary, or renaming the emitted package.
- [references/workspace-wiring.md](references/workspace-wiring.md) — links to `src/`, the scripts and turbo tasks, `nodeOptions` tsx, self-registering bins, tests of built output and built bins, and the `effected-built` condition. Load when: setting up a workspace on the kit, wiring a test that reads `dist`, or a plain-Node consumer such as `rspress build` cannot load a workspace sibling.
- [references/reading-issues.md](references/reading-issues.md) — the `issues.json` shape, the read order (`buildOk`, `ciFatal`, warnings), freshness, the journals, and a `jq` recipe. Load when: deciding whether a build passed, or before fixing anything it reported.
- `authoring-tsdoc` — the release-tag policy, the supported-tag allow-list, custom tags and every `ae-*`/`tsdoc-*` fix. Load when: `issues.json` reports an `ae-*` or `tsdoc-*` code.
- `building-a-github-action` — `effected action build`, `effected action init` and the `[action]` tables, which this skill does not cover. Load when: the package is a GitHub Action.
