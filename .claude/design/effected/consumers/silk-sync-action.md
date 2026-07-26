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
  - ../packages/config-file.md
---

# silk-sync-action — migration map

## Overview

`/Users/spencer/workspaces/savvy-web/silk-sync-action` synchronizes labels, repository settings and ProjectV2 membership across a fleet of repositories, driven by a `SilkConfig` JSON file. It is a GitHub-API-only consumer: no subprocesses, no SBOM, no publishing.

**Blast radius.** The spec counts **one** production file for the `*Live` rename (`src/layers/app.ts`) and 12 of 17 test files needing rewrite. The survey widens the first number: **16 src files import the package**, but only `src/layers/app.ts` imports `*Live` *layers* — the other fifteen import service tags and error types, most of them type-only. So the rename is a one-file edit and the tag-import churn is mechanical, while the real cost is the test suite, which is on plain vitest with `Effect.runPromise` (25 call sites) and pulls every double through the `./testing` subpath that does not survive.

Two things make this repo the program's clearest tree-shaking evidence: it invokes **no** SBOM code and still carries an 11-line bundler `ignore` for CycloneDX's optional XML plugins, and it re-derives octokit typings nine times in one file because `GitHubClient.rest` hands back `unknown`.

## `@savvy-web/github-action-effects`

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Action` | `src/main.ts`, `src/pre.ts`, `src/post.ts` | `Action.run` (`@effected/github-actions`) | Phase 3 pending |
| `Step` | `src/program.ts` | `ActionLogger` buffered step renderer (`@effected/github-actions`) | Phase 3 pending |
| `ActionState` | `src/pre.ts`, `src/post.ts`; local `StartTimeState` in `src/state.ts` | `ActionState` (`@effected/github-actions`) | Phase 3 pending |
| `ActionOutputs` | `src/program.ts` | `ActionOutputs` (`@effected/github-actions`) | Phase 3 pending |
| `ActionInput` (`.multiline`) | `src/inputs.ts` | `ActionInput.lines` / `.list` / `.pairs` (`@effected/github-actions`) — `Config`-backed | Phase 3 pending |
| `GithubMarkdown` | `src/reporting/summary.ts` | `ActionLogger` summary surface (`@effected/github-actions`) | Phase 3 pending |
| `GitHubToken` | `src/pre.ts`, `src/post.ts`, `src/layers/app.ts` | `GitHubToken.provision` / `.dispose` (`@effected/github-actions`), with documented member usage | Phase 3 pending |
| `ConfigLoader` / `ConfigLoaderLive` | `src/layers/app.ts`, `src/program.ts` (`loadJson(configFile, SilkConfig)`) | `ConfigFile.read(path, { schema, codec: JsonCodec })` (`@effected/config-file`) | shipped |
| `GitHubClient` (tag + type) | `src/program.ts`, `src/github/reads.ts`, `src/sync/{labels,settings,projects,processRepos,syncRepo}.ts`, `src/discovery/{index,explicit,customProperties}.ts` | `GitHubClient` (`@effected/github`) with the route-keyed `Rest` surface | Phase 2 pending |
| `GitHubClientError` | `src/sync/labels.ts`, `src/github/reads.ts` | one `GitHubError` (kind/operation/reason) (`@effected/github`) | Phase 2 pending |
| `GitHubGraphQL` / `GitHubGraphQLLive` / `GitHubGraphQLError` | `src/sync/projects.ts`, `src/sync/{processRepos,syncRepo}.ts`, `src/layers/app.ts` | folds into `GitHubClient`; documents become consumer-owned `GraphQLDocument` values (`@effected/github`) | Phase 2 pending |
| `GitHubAppLive`, `OctokitAuthAppLive` | `src/layers/app.ts` | `GitHubApp.clientLayer(options)` (`@effected/github`); `OctokitAuthApp` is deleted with `@octokit/auth-app` | Phase 2 pending |
| `ActionStateLive` | `src/layers/app.ts` | `ActionState.layer` (`@effected/github-actions`) | Phase 3 pending |
| `ErrorAccumulator` | `src/sync/processRepos.ts` | no kit construct — fan-out-and-accumulate over `Effect.forEach` | consumer-side composition |
| `./testing` doubles — `ActionOutputsTest`, `ActionStateTest`, `ActionLoggerTest`, `ConfigLoaderTest`, `GitHubClientTest`, `GitHubGraphQLTest`, `GitHubAppTest`, `GitHubAppTestState` | 12 test files (`src/**/*.test.ts`) | per-service `static layerTest(overrides?)` / `makeTest` on the main entry; **no `./testing` subpath** | Phases 2–3 pending |

## `@savvy-web/silk-effects`

Not consumed. The package is neither imported nor declared in `package.json`.

## Hand-rolled code the kit absorbs

| Local file | What it hand-rolls | Effected construct | Status |
| --- | --- | --- | --- |
| `src/github/reads.ts` | `RestOctokit` / `PaginateOctokit<T>` / `RequestOctokit` local interfaces, **9 cast sites** plus a `Promise<{data: …}>` return cast, all because `GitHubClient.rest` returns `unknown` | `Rest.Route` / `Params` / `Data` — the route is the key, no casts (`@effected/github`) | Phase 2 pending — fluency case 1 |
| `src/sync/projects.ts` | `isAlreadyExists` — lowercases `reason` + every GraphQL message and tests `.includes("already") \|\| .includes("exists")` | `GitHubError` with an `alreadyExists` discriminant (`@effected/github`) | Phase 2 pending |
| `src/sync/projects.ts` | `RESOLVE_PROJECT_QUERY`, `LINK_REPO_MUTATION`, `ADD_ITEM_MUTATION` inline template strings | stays here as consumer-owned `GraphQLDocument` values — typed variables, decoded responses | consumer-side composition |
| `src/inputs.ts` | `stripComments` (drop blanks and `#` lines) and `parseCustomProperties` (`key=value` line parser), over `ActionInput.multiline` | `ActionInput.list` and `ActionInput.pairs` (`@effected/github-actions`) | Phase 3 pending |
| `src/sync/settings.ts` | `SYNCABLE_KEYS` allowlist diffed against current settings | `GitHubRepository.settings` / `.updateSettings` — the faithful `RepoSettings` projection (`@effected/github`) | Phase 2 pending |
| test files (15 of them) | `Effect.provide(Logger.layer([]))` **23 times** to silence logs | `ActionLogger.layerSilent()` (`@effected/github-actions`) | Phase 3 pending |
| `action.config.ts` | `ignore: ["xmlbuilder2", "libxmljs2", "ajv-formats-draft2019"]` — CycloneDX optional plugins reaching a repo that never builds an SBOM | **deleted by construction**: SBOM lives in `@effected/sbom`, which this repo never installs | Phase 4 pending |

## Stays local

- **ProjectV2 is this repo's domain**, not the kit's. The three GraphQL documents stay here; `@effected/github` supplies the `GraphQLDocument` mechanism and the typed error, not the ProjectV2 vocabulary.
- **`src/discovery/*`** — repo enumeration by custom property or explicit list, plus the de-dup/merge keyed on lowercased `fullName`. Domain logic.
- **`src/schemas.ts` (`SilkConfig`)** and **`src/errors.ts` (`InvalidInputError`, `DiscoveryError`)** — app vocabulary.
- **`src/sync/syncRepo.ts` / `processRepos.ts`** — the per-repo orchestration and fan-out policy.
- **`src/state.ts` (`StartTimeState`)** — an app-defined `Schema.Class` persisted through `ActionState`; the mechanism moves, the shape does not.
- **`action.config.ts` `persistLocal`** — a `@savvy-web/github-action-builder` feature, untouched by this program.

## Open questions

1. **`ErrorAccumulator` has no named replacement.** It is a fan-out-and-accumulate helper used once, in `src/sync/processRepos.ts`. The program's position is consumer-side composition over `Effect.forEach`, but nothing has been written down deciding that; if a second consumer wants it, it is a candidate for a small kit combinator.
2. **The test-framework move.** Program decision 8 says consumers adapt to `@effect/vitest`. This repo is 25 `Effect.runPromise` call sites and 17 plain-vitest files — the largest single conversion among the five API consumers, and it is not scheduled by any phase.
