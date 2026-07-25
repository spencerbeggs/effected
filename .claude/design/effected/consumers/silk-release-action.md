---
status: current
module: effected
category: migration
created: 2026-07-25
updated: 2026-07-25
completeness: 90
related:
  - README.md
  - ../../plans/2026-07-25-github-split-master.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/workspaces.md
  - ../packages/markdown.md
  - ../packages/commands.md
  - ../packages/npm.md
---

# silk-release-action — migration map

## Overview

`/Users/spencer/workspaces/savvy-web/silk-release-action` is the release pipeline: it detects the workflow phase, cuts and syncs a release branch, validates builds, packs and publishes to npm/JSR/GitHub Packages, builds SBOMs and attestations, cuts GitHub releases with assets, and links and closes the issues a release resolves.

**Blast radius — larger than the spec recorded.** Spec §8 counts "7 src files, 31 identifiers" and "21 of 39" test files. The survey finds **26 src files and 21 test files** actually import `@savvy-web/github-action-effects` (47 files in all). The spec's smaller number counts `*Live` *layer* sites; the wider number counts every tag, error type and helper import. The `*Live` rename is still concentrated in `src/main.ts` — the practical consequence is that the tag-import churn touches four times as many files as planned, while the test rewrite estimate holds.

This is the only consumer that touches the supply-chain surface (`Attest`, `Sbom`, `SigstoreSigner`, `OidcTokenIssuer`, `PackagePublish`, `NpmRegistry`), which is why Phases 4 and 5 exist and why this repo is the program's dogfooding target at the end.

It also carries the largest set of hand-rolled capabilities the kit absorbs — twelve local files, from tag-strategy detection to an NTIA-compliance validator.

## `@savvy-web/github-action-effects`

Grouped by destination package rather than one row per identifier; the identifier count is large and the destination is what a migration needs.

### Actions runtime → `@effected/github-actions` (Phase 3 pending)

| Old construct | Where used |
| --- | --- |
| `Action` | `src/main.ts`, `src/pre.ts`, `src/post.ts` |
| `Step` | `src/main.ts`, `src/release/{publish,releases,validation}.ts`, `src/utils/turbo-summary.ts` |
| `ActionEnvironment` / `…Error` / `…Live` | `src/main.ts`, `src/utils/{check-release-branch,close-linked-issues,create-release-branch,create-validation-check,detect-workflow-phase,link-issues-from-commits,update-release-branch,validate-builds}.ts` |
| `ActionOutputs` / `…Error` / `…Live` / `…Shape` | `src/main.ts`, `src/pre.ts`, and 8 `src/utils/*.ts` files |
| `ActionState` / `…Live` | `src/main.ts`, `src/pre.ts`, `src/post.ts`, `src/release/{publish,validation}.ts`, `src/utils/{commit-signoff,create-release-branch,update-release-branch}.ts` |
| `ActionLogger` | `src/main.ts`, `src/release/{publish,releases}.ts` |
| `ActionsConfigProvider` | `__test__/load-release-config.test.ts`, `src/release/validation.test.ts` → replaced by `ActionInput`'s `INPUT_` `ConfigProvider` |
| `GitHubToken` | `src/main.ts`, `src/pre.ts`, `src/post.ts`, `src/utils/commit-signoff.ts` + 2 tests → `GitHubToken.provision` / `.read` / `.botIdentity` / `.dispose` with the member-usage table |
| `GithubMarkdown` | `src/release/report.ts` → the `ActionLogger` summary surface |
| `OidcTokenIssuer` / `…Live` | `src/release/attest-helpers.ts`, `src/release/releases.ts`, `src/main.ts` |
| `DryRun` (via `main.ts` wiring) | `src/main.ts` |

### GitHub API → `@effected/github` (Phase 2 pending)

| Old construct | Where used | Note |
| --- | --- | --- |
| `GitHubClient` / `…Error` / `…Live` | `src/main.ts`, `src/release/releases.ts`, `src/utils/{create-release-branch,link-issues-from-commits,update-release-branch}.ts` | `layerFromConfig` / `layerFromToken`; one `GitHubError` replaces 18 |
| `GitHubApp` / `…Live`, `OctokitAuthAppLive` | `src/pre.ts`, `src/post.ts` | `GitHubApp.clientLayer(options)`; `OctokitAuthApp` deleted with `@octokit/auth-app` |
| `GitHubGraphQLLive` | `src/main.ts`, `src/utils/link-issues-from-commits.ts` | folds into `GitHubClient` |
| `GitBranch` / `…Error` / `…Live` | `src/utils/{check-release-branch,update-release-branch}.ts`, `src/main.ts` | gains `upsert`, `createLinked` |
| `GitCommit` / `…Error` / `…Live` | `src/utils/{create-release-branch,update-release-branch}.ts`, `src/main.ts` | gains `commitFiles` |
| `GitTag` / `…Error` / `…Live` | `src/release/releases.ts`, `src/utils/{create-release-branch,link-issues-from-commits}.ts`, `src/main.ts` | gains `latestSemver` |
| `GitHubCommit` / `…Live` | `src/release/publish.ts`, `src/utils/{create-release-branch,link-issues-from-commits}.ts`, `src/main.ts` | |
| `GitHubContent` / `…Live` | `src/release/publish.ts`, `src/main.ts` | gains `getFileOption` |
| `GitHubIssue` / `…Error` / `…Live`, `IssueData` | `src/utils/{close-linked-issues,create-release-branch,link-issues-from-commits,update-release-branch}.ts`, `src/main.ts` | gains `linkedIssues(pr, { userLinkedOnly })` |
| `GitHubRelease` / `…Error` / `…Live` | `src/release/releases.ts`, `src/main.ts` | |
| `PullRequest` / `…Error` / `…Live`, `PullRequestInfo` | `src/release/publish.ts`, 5 `src/utils/*.ts`, `src/main.ts` | gains `upsert`, `setAutoMerge` |
| `PullRequestComment` / `…Error` / `…Live` | `src/utils/update-sticky-comment.ts`, `src/main.ts` | `upsert(pr, marker, body)` |
| `CheckRun` / `…Error` / `…Live`, `CheckRunAnnotation` | 6 `src/utils/*.ts`, `src/main.ts` | `CheckRunOutput` with byte budgeting |
| `GitHubArtifactMetadata` / `…Error` / `…Live` | `src/release/releases.ts`, `src/main.ts` | `ArtifactMetadata.createStorageRecord` |
| `Attest` / `…Error` / `…Live` | `src/release/{publish,releases}.ts`, `src/main.ts` | **splits three ways** — REST surface → `Attestation` here |
| `SemverResolver` | `src/utils/link-issues-from-commits.ts` | `@effected/semver` (shipped) |

### Subprocess → `@effected/commands` (shipped)

| Old construct | Where used | Replacement |
| --- | --- | --- |
| `CommandRunner` / `…Error` / `…Live`, `CommandResponse` | `src/main.ts`, `src/release/{meta-archive,publish,releases,validation}.ts`, `src/utils/{count-changesets,create-release-branch,format-workspace,native-version,update-release-branch,validate-builds}.ts` + 8 test files | **not a service** — `Run.collect` / `Run.json` free combinators over core's `ChildProcessSpawner`; `CommandRunnerTest`'s exit-0-for-unregistered lie dies with it |

### Supply chain and publishing

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Sbom` / `SbomError` / `SbomInput` / `SbomLive` | `src/release/{publish,validation}.ts`, `src/main.ts` | `Sbom` (`@effected/sbom`) | Phase 4 pending |
| `SigstoreSigner` / `…Live` | `src/release/releases.ts`, `src/main.ts` | `SigstoreSigner` (`@effected/sbom`) | Phase 4 pending |
| `buildSLSAProvenancePredicate`, `decodeJwtClaims` | `src/release/attest-helpers.ts` | the mint→sign→SBOM→attest pipeline is **consumer composition** over `OidcTokenIssuer` + `Sbom` + `Attestation` | consumer-side composition |
| `PackagePublish` / `…Error` / `…Live` | `src/release/{publish,validation}.ts`, `src/main.ts` | `PackagePublish` over `Run`, with token masking hoisted to the caller (`@effected/npm`) | Phase 5 pending |
| `NpmRegistry` / `…Live` | `src/release/publish.ts`, `src/main.ts` | `NpmRegistry` keyed `(registry, package, version)` (`@effected/npm`) | Phase 5 pending |
| `ResolvedDependency` | `src/release/{publish,validation}.ts` | resolves with the `npm` extension | Phase 5 pending |

### Not ported

| Old construct | Where used | Answer | Status |
| --- | --- | --- | --- |
| `ChangesetAnalyzer` / `…Live` | `src/main.ts` | not ported — spec §3's do-not-port list; changesets are policy | stays local |
| `ErrorAccumulator` | `src/release/publish.ts` | no kit construct — fan-out-and-accumulate over `Effect.forEach` | consumer-side composition |
| `ReportBuilder` | `src/release/report.ts` | no kit construct — report shaping is release policy | stays local |
| `isNpmRegistry`, `isJsrRegistry`, `isGitHubPackagesRegistry`, `getRegistryDisplayName` | `src/release/{publish,releases,report,resolve-targets,validation}.ts`, `src/utils/registry-label.ts` | **unclaimed** — flat helpers no phase assigns a home | decision pending |
| the `./testing` doubles — 20+ `*Test` / `*TestState` symbols across 21 test files | see §Testing below | per-service `layerTest(overrides?)` / `makeTest` on the main entry | Phases 2–5 pending |

## `@savvy-web/silk-effects`

| Old construct | Where used | Effected replacement | Status |
| --- | --- | --- | --- |
| `Changesets` | `src/changelog/silk.ts`, `src/release/layers.ts`, `src/utils/{native-version,create-release-branch,update-release-branch}.ts` + 3 tests | none — the changesets engine is spec §9 policy | stays local |
| `ChangesetConfig` / `…Live`, `ChangesetConfigReaderLive`, `ChangesetMode` | `src/release/{changeset-config,layers}.ts` | none | stays local |
| `SilkPublishability`, `SilkPublishabilityDetectorLive`, `PublishabilityDetectorAdaptiveLive`, `PublishablePackage` | `src/release/{publishability,resolve-targets}.ts`, `src/utils/release-summary-helpers.ts` | none — silk's publishability *policy* stays; `@effected/workspaces` supplies the `PublishabilityDetector` contract it implements | stays local |
| `PublishTargetBindingError` | `src/release/resolve-targets.ts` | none | stays local |

## `@effected/*` already in use

| Package | Where | Constructs |
| --- | --- | --- |
| `@effected/workspaces` | `src/release/{layers,publish,releases,resolve-targets,validation}.ts`, `src/utils/{create-release-branch,detect-repo-type,determine-tag-strategy,release-summary-helpers,sort-releases-topologically,update-release-branch}.ts` + 9 tests | `Workspaces`, `WorkspaceDiscovery`, `WorkspacePackage`, `PublishabilityDetector`, `DependencyGraph`, `PublishTarget`, and the `node-sync` subpath (`findWorkspaceRootSync`, `getWorkspacePackagesSync`, `nodeSyncOps`) |
| `@effected/jsonc` | `src/utils/load-release-config.ts` | `Jsonc` |

## Hand-rolled code the kit absorbs

| Local file | What it hand-rolls | Effected construct | Status |
| --- | --- | --- | --- |
| `src/utils/determine-tag-strategy.ts` | Single-vs-multi tag strategy from publishable packages + changeset config, plus `isMonorepoForTagging` | `VersioningStrategy.classify` / `.detect` and `strategy.tagsFor(releases, options?)` (`@effected/workspaces`) — collapses ~110 lines to two. **Note (round-1 finding, resolved 2026-07-25): `ReleaseTag` now defaults to strict SemVer with no `v` prefix on all names — Savvy convention holds with zero options; a repo whose existing tags carry `v` must pass `versionPrefix: "v"` or tag names silently change** | shipped |
| `src/utils/extract-release-notes.ts` | A `node:fs` read plus a scan for the topmost `##` section of a `CHANGELOG.md` | `MarkdownDocument.firstSection({ depth: 2 })` / `sectionByHeading(match)` — fenced-code false positives and setext headings fixed by construction (`@effected/markdown`) | shipped |
| `src/utils/native-version.ts` | Temporary `process.env.GITHUB_TOKEN` mutation around a sub-Effect, admitted in a comment as "not parallel-safe"; plus a reset-then-retry for a non-idempotent apply | `ActionEnvironment.withEnv(overrides, effect)` — fiber-scoped via `Context.Reference`, never touches `process.env` (`@effected/github-actions`); retry classification via `Retry` (`@effected/commands`) | Phase 3 pending — fluency case 5 |
| `src/release/meta-archive.ts` | `CommandRunner`-driven `tar -C <parent> <metaBasename>` to pack a bundler `meta/` folder | `@effected/archive` — built at first need, expected Phase 4 where attestation wants byte-reproducible artifacts | Phase 4 pending |
| `src/utils/infer-sbom-metadata.ts` | Derives SBOM supplier/author/repository from `package.json` via plain `node:fs` | SBOM-metadata-from-manifest over `@effected/package-json` (`@effected/sbom`) | Phase 4 pending |
| `src/utils/validate-ntia-compliance.ts` | Checks a CycloneDX document against the 7 NTIA minimum elements | the NTIA-minimum-elements validator (`@effected/sbom`) — a published standard, portable as-is | Phase 4 pending |
| `src/utils/create-validation-check.ts` | Aggregates per-step results into one Check Run, hand-respecting the 65535-**byte** summary cap | `CheckRunOutput` with byte budgeting (`@effected/github`) | Phase 2 pending |
| `src/utils/link-issues-from-commits.ts` | Inline `closingIssuesReferences` GraphQL (two variants) + an add-comment mutation; ~35 lines of `Effect`-per-comparison latest-tag selection | `GitHubIssue.linkedIssues(pr, { userLinkedOnly })` (the consumer's superset document becomes the library's) and `GitTag.latestSemver()` over `SemVer.compare`; the node-id `addComment` mutation is dropped for `GitHubIssue.comment` (`@effected/github`) | Phase 2 pending |
| `src/utils/create-release-branch.ts` | Inline `createLinkedBranch` and `createPullRequest` mutations; a retry-once-on-network-blip around PR creation | `GitBranch.createLinked({ issueNodeId, name, oid })` (no REST equivalent exists, so the kit owns it) and `PullRequest.create` returning `PullRequestInfo.nodeId` (`@effected/github`) | Phase 2 pending |
| `src/utils/update-release-branch.ts` | Branch sync plus its own retry-once | `GitBranch.upsert` / `.reset`, `PullRequest.upsert` (`@effected/github`) | Phase 2 pending |
| `src/utils/normalize-package-manager.ts` + `src/utils/detect-repo-type.ts` | **Two of the three disagreeing package-manager detections** (this pair defaults `npm`, `detect-repo-type` defaults `pnpm`), plus lockfile sniffing over the `node-sync` subpath | `PackageManagerDetector` with the standalone-repo lockfile tier and the manifest-only tier — and it still refuses to guess (`@effected/workspaces`) | shipped |
| `src/utils/count-changesets.ts` | Counts pending changesets by reading the target branch's `.changeset` dir through `git ls-tree` / `git show` | **no kit replacement** — third independent changeset-parsing reimplementation; `@effected/changesets` is spec §9's deferred idea. The git plumbing itself is `@effected/git` | decision pending |
| 12 test files | `Effect.provide(Logger.layer([]))` **16 times** | `ActionLogger.layerSilent()` (`@effected/github-actions`) | Phase 3 pending |
| 7 test files | `Layer.succeed(WorkspaceDiscovery, {...})` stubs | `WorkspaceDiscovery.layerTest(overrides?)` — already shipped | shipped |

## Stays local

- **Release policy** — phase detection rules, which registries to target, the changeset/versioning configuration, the report content and the summary shape.
- **`@savvy-web/silk-effects`** entirely: `Changesets`, `ChangesetConfig`, `SilkPublishability`. The kit supplies the `PublishabilityDetector` contract; silk's implementation of it stays downstream.
- **`src/release/attest-helpers.ts`** — the mint→sign→SBOM→attest ordering is composition, per program decision 5. `buildSLSAProvenancePredicate` and `decodeJwtClaims` come with it unless Phase 4 finds a second consumer.
- **`src/release/report.ts` (`ReportBuilder`)** and `src/utils/registry-label.ts` — how a release reads, not how it works.
- **`src/utils/turbo-summary.ts`, `src/utils/format-workspace.ts`, `src/utils/validate-builds.ts`** — build-validation policy over the kit's runner.

## Open questions

1. **The spec's blast-radius number is wrong for this repo** (7 src files vs the actual 26). Phase 6's fluency audit and any migration estimate should use 26/21, not 7/21.
2. **`release-age.ts` is not in this repo.** Spec §7 attributes `npm view <pkg> time --json` to `silk-release-action/src/services/release-age.ts`; no such file exists here. It is **silk-update-action's** `src/services/release-age.ts`. The `NpmRegistry.publishTimes` mandate is unchanged — only the consumer attribution was wrong.
3. **The registry-label helpers have no home.** `isNpmRegistry` / `isJsrRegistry` / `isGitHubPackagesRegistry` / `getRegistryDisplayName` are flat exports of the old package used across six files here, and no phase claims them. They are small enough to inline locally; that should be a recorded decision rather than a discovery at migration time.
4. **`ErrorAccumulator` is used by two consumers** (here and silk-sync-action) with no named replacement.
5. **The tar call arrives before its trigger.** `meta-archive.ts` is the one surveyed `tar` shell-out, and decision 5 builds `@effected/archive` at Phase 4's attestation need. If Phase 4's determinism requirement turns out narrower than this consumer's, the archive package still has to cover it.
6. **`ActionsConfigProvider`** is used in two test files and appears in no phase's replacement table; `ActionInput`'s `INPUT_` provider is the presumed answer but is not stated anywhere.
