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
  - ../packages/jsonc.md
---

# claude-code-marketplace-manager — migration map

## Overview

`/Users/spencer/workspaces/spencerbeggs/claude-code-marketplace-manager` is a single-purpose GitHub Action: it edits a Claude Code marketplace manifest (comment-preserving JSONC), validates the result, and lands the change either directly or through a pull request.

**Blast radius — the smallest of the six consumers.** Eight src files and two test files import `@savvy-web/github-action-effects`; only `src/layers/app.ts` imports `*Live` layers, matching spec §8's "1 file, 7 symbols" (the survey counts 8 symbols there). The interesting work is concentrated in one service, `src/services/ManifestCommitter.ts`, which carries both of this repo's contributions to spec §7: the TOCTOU branch-create dance and the `repos.get` / `default_branch` hand-roll with its local octokit cast interface.

It is also the **only consumer already largely on `@effect/vitest`** — seven of twelve test files use `it.effect`, and there is exactly one `Effect.runPromise` in the whole repo (in a build script, not a test). The framework migration that costs the other consumers is mostly already paid here.

The comment-preserving JSONC editing is deliberately untouched: it is already on `@effected/jsonc` and stays there (decisions-log Phase 1c item 7).

## `@savvy-web/github-action-effects`

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Action` | `src/main.ts`, `src/pre.ts`, `src/post.ts` | `Action.run` (`@effected/github-actions`) | Phase 3 pending |
| `ActionState` / `ActionStateLive` | `src/pre.ts`, `src/post.ts`, `src/layers/app.ts` | `ActionState` (`@effected/github-actions`) | Phase 3 pending |
| `ActionOutputs` | `src/program.ts` | `ActionOutputs` (`@effected/github-actions`) | Phase 3 pending |
| `ActionInput` | `src/inputs.ts` | `ActionInput.string` / `.boolean` / `.schema` — `Config`-backed (`@effected/github-actions`) | Phase 3 pending |
| `GithubMarkdown` | `src/report.ts` | `ActionLogger` summary surface (`@effected/github-actions`) | Phase 3 pending |
| `GitHubToken` | `src/pre.ts`, `src/post.ts`, `src/program.ts`, `src/layers/app.ts` | `GitHubToken.provision` / `.botIdentity` / `.dispose`, with the documented member-usage table (`@effected/github-actions`) | Phase 3 pending |
| `GitHubAppLive`, `OctokitAuthAppLive` | `src/layers/app.ts` | `GitHubApp.clientLayer(options)` (`@effected/github`); `OctokitAuthApp` deleted with `@octokit/auth-app` | Phase 2 pending |
| `GitHubGraphQLLive` | `src/layers/app.ts` | folds into `GitHubClient` (`@effected/github`) | Phase 2 pending |
| `GitHubClient` / `GitHubClientError` | `src/services/ManifestCommitter.ts` | `GitHubClient` + the route-keyed `Rest` surface; one `GitHubError` (`@effected/github`) | Phase 2 pending |
| `GitBranch` / `GitBranchError` / `GitBranchLive` | `src/services/ManifestCommitter.ts`, `src/layers/app.ts`, both test files | `GitBranch` incl. **`upsert`** and an `alreadyExists` discriminant (`@effected/github`) | Phase 2 pending |
| `GitCommit` / `GitCommitError` / `GitCommitLive` | `src/services/ManifestCommitter.ts`, `src/layers/app.ts` | `GitCommit.commitFiles` (`@effected/github`) | Phase 2 pending |
| `PullRequest` / `PullRequestError` / `PullRequestLive` | `src/services/ManifestCommitter.ts`, `src/layers/app.ts` | `PullRequest.upsert`, `PullRequest.setAutoMerge` (`@effected/github`) | Phase 2 pending |
| `./testing` doubles — `ActionEnvironmentTest`, `ActionLoggerTest`, `ActionOutputsTest`, `ActionStateTest`, `GitBranchTest`, `GitCommitTest`, `GitHubClientTest`, `PullRequestTest` + their `*TestState` types | `__test__/program.test.ts`, `__test__/services/ManifestCommitter.test.ts` | per-service `layerTest(overrides?)` on the main entry; **no `./testing` subpath** | Phases 2–3 pending |

## `@savvy-web/silk-effects`

Not consumed. Every `silk-effects` string in the repo is inside the read-only `.repos/systems` vendored submodule, which exists as agent-authority reference source, not as a dependency.

## `@effected/*` already in use

| Package | Where | Constructs |
| --- | --- | --- |
| `@effected/jsonc` | `src/services/ManifestEditor.ts`, `src/services/ManifestValidator.ts` | `Jsonc`, `JsoncEdit`, `JsoncModifier`, `JsoncModificationError`, `JsoncParseError` |

## Hand-rolled code the kit absorbs

| Local file | What it hand-rolls | Effected construct | Status |
| --- | --- | --- | --- |
| `src/services/ManifestCommitter.ts` (`land`) | The TOCTOU branch dance: `exists` → `reset` or `create`, then on `GitBranchError` re-check `exists` and `reset` if a concurrent run won the race — because `GitBranchError` carries only a free-form `reason` and no "already exists" discriminant | `GitBranch.upsert(name, sha)` — one call, no dance; plus an `alreadyExists` discriminant on `GitHubError` (`@effected/github`) | Phase 2 pending — fluency case 2 |
| `src/services/ManifestCommitter.ts` (`resolveBaseBranch`) | Reads `client.repo`, then `client.rest<{default_branch}>("repos.get", (octokit) => (octokit as ReposGetOctokit).rest.repos.get(…))` through a locally-declared `ReposGetOctokit` interface, because the kit's `rest()` hands back `unknown` | `GitHubRepository.defaultBranch` over a typed `repos.get` projection (`@effected/github`) | Phase 2 pending — fluency case 1 |
| `src/inputs.ts` | `export type AutoMergeMethod = "merge" \| "squash" \| "rebase"` | `PullRequest.setAutoMerge` names the method type; the old package never exported one (see open questions) | Phase 2 pending |
| `__test__/services/ManifestCommitter.test.ts` | `racyBranch` and `brokenBranch` — two ad-hoc objects typed `typeof GitBranch.Service`, hand-implementing the shape to drive the two race-recovery branches | `GitBranch.layerTest(overrides?)` with unstubbed members dying loudly (`@effected/github`) | Phase 2 pending |

## Stays local

- **JSONC editing.** `src/services/ManifestEditor.ts`'s `Jsonc.parse` → `JsoncModifier.modify` → `JsoncEdit.applyAll` pipeline is already the kit's answer, and a `// marketplace` comment surviving an edit is a pinned test. Decisions-log Phase 1c item 7 records this as a **non-gap**.
- **`src/services/ManifestValidator.ts`** — Ajv against a bundled SchemaStore-derived JSON Schema, alongside the Effect Schema decoders in `src/schema/*.ts`. Neither kit package offers this and none is planned.
- **`src/schema/*.ts`, `src/report.ts`, `src/state.ts`** — marketplace-manifest vocabulary and report shaping.
- **`lib/scripts/generate-schema.ts`** — generates JSON Schema from the repo's own Effect Schemas and drift-checks the committed files. Unrelated to this program.

## Open questions

1. **The `AutoMergeMethod` finding needs correcting.** Spec §1 says the repo "re-declared `AutoMergeMethod` when `AutoMerge` was already exported". The survey finds the old package never exports a named `AutoMergeMethod` — it inlines the literal `"merge" | "squash" | "rebase" | false` in `PullRequest.ts` and its two layers. The local declaration is a narrower independent type (no `false`), not a duplicate of an available export. The discovery defect the spec meant (a 360-symbol flat surface hiding what exists) still holds; this particular example does not.
2. **`resolveBaseBranch` is structurally untestable today**, and the migration should not carry that forward. No test calls it, and even if one did, `GitHubClientTest.rest()` keys on the operation-name string and **ignores the callback entirely** — so the hand-rolled `ReposGetOctokit` cast can never be validated against the real octokit shape. A typed `GitHubRepository.defaultBranch` removes the cast; the missing test is a separate, still-open gap.
3. **`src/program.ts`'s success path has no end-to-end test.** `__test__/program.test.ts` covers dry-run, no-op and input-failure only; the `botIdentity` → `resolveBaseBranch` → `land` tail is exercised only by direct `land` calls in the committer's own test. `src/pre.ts`, `src/post.ts` and `src/main.ts` have no test files at all.
4. **The `with { type: "json" }` schema import** in `ManifestValidator.ts` carries a `biome-ignore` for a build-tool interaction (`forceJsExtensions` rewriting `.json` to `.js`). Not a kit concern, but it travels with any import-resolution change the migration makes.
