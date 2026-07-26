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
---

# silk-router-action — migration map

## Overview

`/Users/spencer/workspaces/savvy-web/silk-router-action` decides which release phase a workflow run is in — reading the event payload, finding the pull request associated with a commit, and counting pending changesets — then routes downstream jobs accordingly.

**Blast radius.** Five src files and three test files import `@savvy-web/github-action-effects`; the spec counts ~16 `*Live` sites. Nearly all of the interesting migration is concentrated in one module, `src/services/phase-detector.ts`, which hand-rolls four separate mechanisms the kit is designing: a retry-with-delay poll, a `FileSystem` re-injection dance to keep `payload`'s `R` empty, an untyped octokit callback for "PRs associated with a commit", and an `Effect.suspend` guard that exists only because the poll was hand-written.

This repo is also where the `layerFromConfig` decision pays off directly: `src/layers/app.ts` carries `Layer.orDie` plus a five-line comment justifying why a construction-time `GitHubClientError` has to be promoted to a defect.

## `@savvy-web/github-action-effects`

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Action` | `src/main.ts` | `Action.run` (`@effected/github-actions`) | Phase 3 pending |
| `Step` | `src/program.ts` | `ActionLogger` buffered step renderer (`@effected/github-actions`) | Phase 3 pending |
| `ActionOutputs` / `ActionOutputsLive` | `src/program.ts`, `src/services/summary.ts`, `src/layers/app.ts` | `ActionOutputs` (`@effected/github-actions`) | Phase 3 pending |
| `ActionEnvironment` / `ActionEnvironmentLive` | `src/services/phase-detector.ts`, `src/layers/app.ts` | `ActionEnvironment` (`@effected/github-actions`) — `payload`/`repo` now have `R = never` | Phase 3 pending |
| `GithubMarkdown` | `src/services/summary.ts` | `ActionLogger` summary surface (`@effected/github-actions`) | Phase 3 pending |
| `GitHubClient` / `GitHubClientLive.fromEnv()` | `src/services/phase-detector.ts`, `src/layers/app.ts`, `src/program.test.ts`, `src/services/phase-detector.test.ts` | `GitHubClient` + `GitHubClient.layerFromConfig()` over `Config.redacted("GITHUB_TOKEN")` (`@effected/github`) | Phase 2 pending |
| `./testing` doubles — `ActionEnvironmentTest`, `ActionLoggerTest`, `ActionOutputsTest` | `src/program.test.ts`, `src/services/phase-detector.test.ts`, `src/services/summary.test.ts` | per-service `layerTest(overrides?)` on the main entry; **no `./testing` subpath** | Phase 3 pending |

## `@savvy-web/silk-effects`

Not consumed. Zero imports; the only repo-wide mention is a historical CHANGELOG line.

## Hand-rolled code the kit absorbs

| Local file | What it hand-rolls | Effected construct | Status |
| --- | --- | --- | --- |
| `src/services/phase-detector.ts` | `findWithRetry(attemptsLeft)` — a self-recursive `Effect.gen` with `Effect.sleep`, 3 attempts × 10s, instead of a `Schedule` | `DetachedProcess.awaitReady(probe, options?)` — poll-until-domain-predicate (`@effected/github-actions`) | Phase 3 pending |
| `src/services/phase-detector.ts` | `Effect.suspend` around the API call so each retry re-issues it, with an explanatory comment | disappears — `awaitReady` takes the probe as an `Effect` and owns re-issuing it | Phase 3 pending |
| `src/services/phase-detector.ts` | `FileSystem.FileSystem` captured in the layer body and `Effect.provideService`-ed per call, so `detect`'s `R` stays `never`; three-line apology comment | `ActionEnvironment.payload` resolves `FileSystem` at **layer** construction; every member's `R` is `never` (`@effected/github-actions`) | Phase 3 pending |
| `src/services/phase-detector.ts` | `PayloadSubset` / `PullRequestPayload` local interfaces plus `as unknown as` on the payload | typed `WebhookPayload` on `ActionEnvironment` (`@effected/github-actions`) | Phase 3 pending |
| `src/services/phase-detector.ts` | `gh.rest("listPullRequestsAssociatedWithCommit", async (octokit: any) => …)` with a `biome-ignore` for `any` and a local `AssociatedPR` interface | `PullRequest.listAssociatedWithCommit(sha, options?)` (`@effected/github`) | Phase 2 pending — fluency case 1 |
| `src/layers/app.ts` | `GitHubClientLive.fromEnv().pipe(Layer.orDie)` plus a five-line comment explaining why a construction error is fatal | `GitHubClient.layerFromConfig()` — construction failure is an honest `ConfigError`, no `orDie` (`@effected/github`) | Phase 2 pending — fluency case 3 |
| `src/services/changesets.ts` | A complete changeset parser: raw `node:fs` in `Effect.try`, a frontmatter regex, a per-line `name: major\|minor\|patch` regex, and a `{major:3,minor:2,patch:1}` rank table | **no kit replacement in this program** — a `@effected/changesets` is spec §9's explicit "reconsider later, not now" | decision pending |
| `src/program.test.ts`, `src/services/phase-detector.test.ts` | Two near-identical `Layer.succeed(GitHubClient, {...})` fakes (`makeGh` / `makeGhClient`) wiring `graphql`/`paginate`/`paginateStream` to `Effect.die` — the library ships no `GitHubClientTest` | `GitHubClient.layerTest(overrides?)` with the fixture double sharing the Live pagination engine (`@effected/github`) | Phase 2 pending |

## Stays local

- **Phase routing policy** — which event shape means which phase, and the attempt/delay constants. The kit supplies the poll mechanism, not the schedule values.
- **`src/services/changesets.ts`** for now. It duplicates parsing that two sibling repos also duplicate, but no kit package owns changeset parsing and the program deliberately does not add one.
- **`src/schemas/domain.ts`, `src/errors/errors.ts`** — app vocabulary, no old-package dependency.
- **`src/services/summary.ts`** composition — the markdown *rendering* helpers move; what the summary says does not.

## Open questions

1. **Changeset parsing is the third independent reimplementation** (with silk-release-action's `count-changesets` and silk-effects' `ChangesetAnalyzer`). Spec §9 defers `@effected/changesets`; this repo is the cheapest evidence that the deferral has a cost, and nothing in the program schedules revisiting it.
2. **`src/services/changesets.ts` bypasses the Effect `FileSystem` entirely** (raw `node:fs`) while `phase-detector.ts` in the same directory uses the service. Whichever way the migration resolves it, the inconsistency is pre-existing and not something a kit construct fixes on its own.
3. **`vi.mock("node:fs")` coexists with layer-based mocking in `src/program.test.ts`.** The move to `@effect/vitest` (program decision 8) has to land the `node:fs` mocking somewhere; a `FileSystem` test layer is the obvious answer but it is a rewrite, not a swap.
