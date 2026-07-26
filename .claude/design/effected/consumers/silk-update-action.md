---
status: current
module: effected
category: migration
created: 2026-07-25
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 90
related:
  - README.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/npm.md
  - ../packages/commands.md
  - ../packages/workspaces.md
---

# silk-update-action — migration map

## Overview

`/Users/spencer/workspaces/savvy-web/silk-update-action` keeps a repository's dependencies current: it resolves registry versions, rewrites catalogs and manifests, upgrades the package manager and the runtime, runs the install, emits changesets, and opens the update PR.

**Blast radius.** Thirty files import `@savvy-web/github-action-effects` — 15 src, 15 test — which is the second-widest surface after silk-release-action, though the spec's `*Live` count is small (4 files, 16 sites) because the layers are concentrated in `src/layers/app.ts`, `src/pre.ts` and `src/post.ts`. The rest is tags and types.

This is **the furthest-along consumer**: six `@effected/*` packages are already dependencies (`lockfiles`, `npm`, `runtimes`, `semver`, `workspaces`, `yaml`), and `src/services/release-age.ts` carries a doc comment naming `@effected/npm` as the intended home of its logic and shaping its local `PartialReleaseAgeGate` to match the kit's requested type for a drop-in swap. The migration here is less "replace a package" than "finish a move already in progress".

## `@savvy-web/github-action-effects`

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Action` | `src/main.ts`, `src/pre.ts`, `src/post.ts` | `Action.run` (`@effected/github-actions`) | Phase 3 pending |
| `ActionState` / `ActionStateLive` | `src/pre.ts`, `src/post.ts`, `src/layers/app.ts` | `ActionState` (`@effected/github-actions`) | Phase 3 pending |
| `GitHubToken` | `src/layers/app.ts`, `src/pre.ts`, `src/post.ts`, `src/post.test.ts` | `GitHubToken.provision` / `.dispose` with the documented member-usage table (`@effected/github-actions`) | Phase 3 pending |
| `GitHubAppLive`, `OctokitAuthAppLive` | `src/pre.ts`, `src/post.ts` | `GitHubApp.clientLayer(options)` (`@effected/github`); `OctokitAuthApp` is deleted with `@octokit/auth-app` | Phase 2 pending |
| `GitHubGraphQLLive` | `src/layers/app.ts` | folds into `GitHubClient` (`@effected/github`) | Phase 2 pending |
| `DryRunLive` | `src/layers/app.ts` | `DryRun` (`@effected/github-actions`) | Phase 3 pending |
| `ActionInputError` | `src/services/branch.ts`, `src/services/package-manager.ts`, and 2 test files | **gone** — inputs are `Config`-backed, so input failures are `ConfigError` (`@effected/github-actions`) | Phase 3 pending |
| `CheckRunLive` | `src/layers/app.ts` | `CheckRun` (`@effected/github`) | Phase 2 pending |
| `GitBranch` / `GitBranchLive` / `GitBranchShape` / `GitBranchError` / `GitBranchTestState` | `src/services/branch.ts`, `src/layers/app.ts`, `src/services/branch.test.ts` | `GitBranch` incl. `upsert` (`@effected/github`) | Phase 2 pending |
| `GitCommit` / `GitCommitLive` / `GitCommitShape` / `GitCommitError` / `FileChange` | `src/services/branch.ts`, `src/layers/app.ts` | `GitCommit` incl. `commitFiles` (`@effected/github`) | Phase 2 pending |
| `PullRequest` / `PullRequestLive` / `PullRequestShape` / `PullRequestError` / `PullRequestTest` | `src/services/report.ts`, `src/layers/app.ts`, `src/main.test.ts`, `src/services/report.test.ts` | `PullRequest` incl. `upsert` (`@effected/github`) | Phase 2 pending |
| `CommandRunner` / `CommandRunnerLive` / `CommandRunnerShape` / `CommandRunnerError` / `CommandResponse` | `src/services/branch.ts`, `src/services/catalog-config-deps.ts`, `src/services/module-catalogs.ts`, `src/services/release-age.ts`, `src/program.ts`, `src/layers/app.ts`, and 6 test files | **not a service** — `Run.collect` / `Run.json` free combinators over core's `ChildProcessSpawner` (`@effected/commands`) | shipped |
| `NpmRegistry` / `NpmRegistryLive` / `NpmRegistryShape` / `NpmRegistryError` / `NpmRegistryTest` | `src/services/{config-deps,package-manager-upgrade,regular-deps}.ts`, `src/layers/app.ts`, and 6 test files | `NpmRegistry` keyed `(registry, package, version)`, with `RegistryReadError` (`@effected/npm`) | Phase 5 pending |
| `SemverResolver` | `src/utils/semver.ts` | `@effected/semver` (already a dependency here) | shipped |

## `@savvy-web/silk-effects`

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Changesets` (imported as `SilkChangesets`) | `src/layers/app.ts`, `src/services/changesets.ts`, `src/services/changesets.test.ts`, `__test__/integration/changeset-emission.int.test.ts` | none — the changesets engine is spec §9 policy | stays local |

## `@effected/*` already in use

Recorded so the migration does not re-solve solved problems.

| Package | Where | Constructs |
| --- | --- | --- |
| `@effected/workspaces` | `src/layers/app.ts`, `src/program.ts`, `src/services/{catalog-config-deps,package-manager,peer-sync,regular-deps}.ts`, 7 test/integration files | `WorkspaceDiscovery`, `WorkspaceRoot`, `PackageManagerDetector`, `LockfileReader`, `WorkspacePackage` |
| `@effected/npm` | `src/services/release-age.ts` and 2 test files | `ReleaseAgeGate`, `PartialReleaseAgeGate` |
| `@effected/runtimes` | `src/layers/app.ts`, `src/services/runtime-upgrade.ts` + tests | `NodeResolver`, `BunResolver`, `DenoResolver`, `ResolvedVersions` |
| `@effected/semver` | `src/program.ts`, `src/services/peer-sync.ts`, one integration test | `SemVer`, `Range` |
| `@effected/yaml` | `src/services/{config-deps,workspace-yaml}.ts` + test | `Yaml` |
| `@effected/lockfiles` | `src/services/lockfile.test.ts` | fixture typing only (`Lockfile`, `LockfileImporter`, `ResolvedPackage`, …) |

## Hand-rolled code the kit absorbs

| Local file | What it hand-rolls | Effected construct | Status |
| --- | --- | --- | --- |
| `src/utils/input.ts` | `parseMultiValueInput` — JSON arrays, newline/bullet lists with `*` markers and `#` comments, and comma-separated values | `ActionInput.list` (`@effected/github-actions`) now covers the union grammar directly — `-`/`*` bullets and full-line `#` comments, as of 2026-07-26 — so the local `parseMultiValueInput` can be deleted outright on next refresh, not merely swapped alongside `.pairs` | Phase 3 pending |
| `src/services/release-age.ts` | `getPublishTimes` shelling `npm view <pkg> time --json` and hand-filtering `created`/`modified` | `NpmRegistry.publishTimes(name, target?)` returning typed `PublishTime` values (`@effected/npm`) | Phase 5 pending |
| `src/services/catalog-config-deps.test.ts` | A `registry(packages)` factory building a **per-package-keyed** `Layer.succeed(NpmRegistry, …)`, with a comment saying the shipped `NpmRegistryTest` cannot serve two versions of one package as distinct tarballs | `NpmRegistry.layerTest` seeded by `(registry, name, version)` (`@effected/npm`) | Phase 5 pending — this is the exact break the model widening fixes |
| `src/program.inner.test.ts`, `src/services/{lockfile,peer-sync,regular-deps}.test.ts` | **7** `Layer.succeed(WorkspaceDiscovery, {...})` stubs across 4 files | `WorkspaceDiscovery.layerTest(overrides?)` — already shipped | shipped |
| `src/services/catalog-config-deps.test.ts` | Hand-rolled `LockfileReader`, `CommandRunner` (an `execFileSync` shim for real `tar`) and `HttpClient` tarball-server doubles | `LockfileReader.layerTest` (shipped); `@effected/commands`' scripted-spawner fixture; a stubbed core `HttpClient` | shipped / Phase 5 pending |

## Stays local

- **The update policy itself** — which dependency sections to touch, the peer-sync rules, the three-way catalog merge, and the changeset the run emits.
- **`@savvy-web/silk-effects` `Changesets`** — the engine is policy and stays downstream (spec §9).
- **`src/utils/deps.ts` (`parseConfigEntry`)** — pnpm `configDependencies` `version+sha512-…` parsing. Adjacent to kit vocabulary but not claimed by any phase.
- **`src/utils/pnpm.ts`, `src/utils/catalogs.ts`, `src/utils/runtime.ts`** — pure pnpm-version, catalog-map and `devEngines.runtime` manifest helpers.
- **`src/services/module-catalogs.ts` / `catalog-config-deps.ts`** — the fetch-a-config-dependency-tarball-and-import-it flow.

## Open questions

1. **`src/utils/catalogs.ts` reimplements pnpm catalog-field semantics** (`catalog` vs `catalogs`, `Map`-or-object coercion) while `@effected/workspaces` ships `WorkspaceCatalogs` / `CatalogSet`. Whether that is a genuine gap or just an unmigrated call site was not determined by the survey.
2. **`src/utils/runtime.ts` reads and rewrites `devEngines.runtime` in the manifest**, parallel to `@effected/runtimes`' resolvers, which only resolve versions. No phase claims manifest read/write for runtimes.
3. **The tarball fetch-extract-import pattern appears twice** (`module-catalogs.ts` and `catalog-config-deps.ts`, each with its own doubles). It touches `@effected/commands`' tar question — deferred to `@effected/archive` at first need in Phase 4 — but this repo is a second, earlier need that the archive trigger does not currently count.
4. **The test-framework move.** 99 `Effect.runPromise` call sites across 24 plain-vitest files, including four real-integration canaries that drive the live `@effected/workspaces` and `@effected/runtimes` layers. Program decision 8 requires the move; no phase schedules it.
