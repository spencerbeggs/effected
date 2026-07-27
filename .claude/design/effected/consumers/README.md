---
status: current
module: effected
category: migration
created: 2026-07-25
updated: 2026-07-26
last-synced: 2026-07-26
completeness: 87
related:
  - ../packages/commands.md
  - ../packages/templates.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/workspaces.md
  - ../packages/markdown.md
  - ../packages/config-file.md
  - ../packages/npm.md
---

# Consumer migration maps

## Overview

One document per downstream repository affected by the github-split program (`2026-07-25-github-split-master.md`). Each map records **what** a repo will eventually replace with `@effected` constructs and **where** that code lives today — the old construct, the paths that use it, the replacement's package and name, and the phase that ships it.

These are **not** code rewrites. Exact call-site rewrites go stale the moment either side moves; the what-and-where survives. When a phase ships, update the status column here rather than pasting the new code. The five worked rewrites that *are* code live in the Phase 6 fluency audit, deliberately, because they are the acceptance gate rather than the migration record.

The program replaces `@savvy-web/github-action-effects` wholesale and upstreams the mechanism half of `@savvy-web/silk-effects`. Every repo below is **read-only during the program** — surveyed, never modified. Nothing forces a synchronized cutover: all consumers stay pinned at `@savvy-web/github-action-effects@3.x` and migrate deliberately once the kit ships.

## The maps

| Repo | Map | Blast radius |
| --- | --- | --- |
| savvy-web/systems | [systems.md](systems.md) | The source monorepo: `github-action-effects` is replaced wholesale, seven `silk-effects` modules move up, and the `github-actions` Claude Code plugin is superseded by effected-plugin skills in Phase 7. |
| savvy-web/silk-release-action | [silk-release-action.md](silk-release-action.md) | The heaviest consumer — the widest `*Live` surface plus a dozen hand-rolled capabilities (tag strategy, release notes, tar, npm view, SBOM metadata, NTIA validation, GraphQL documents) the kit absorbs. |
| savvy-web/silk-update-action | [silk-update-action.md](silk-update-action.md) | Already the furthest along on `@effected/*`; the remaining work is input parsing, the `NpmRegistry` double, and hand-rolled `WorkspaceDiscovery` stubs in tests. |
| savvy-web/silk-sync-action | [silk-sync-action.md](silk-sync-action.md) | One production file to edit, most of the test suite to rewrite; the only `ConfigLoader` consumer, and the repo carrying the bundler `ignore` escape hatch that tree-shakeable packages make unnecessary. |
| savvy-web/silk-router-action | [silk-router-action.md](silk-router-action.md) | Small src footprint concentrated in the phase detector — polling, payload narrowing, the PR-for-commit raw octokit callback, and the `Layer.orDie` comment that `layerFromConfig` dissolves. |
| savvy-web/silk-runtime-action | [silk-runtime-action.md](silk-runtime-action.md) | The sixth consumer, missed by the original survey. Runner-local only: `BlobStore` + the embedded Turbo cache server, `ToolInstaller`, the `ActionCache` ladder, detached-process lifecycle, and the `Redacted` cross-process handoff. |
| spencerbeggs/claude-code-marketplace-manager | [claude-code-marketplace-manager.md](claude-code-marketplace-manager.md) | Smallest: one production file for layers, the `ManifestCommitter` TOCTOU dance that `GitBranch.upsert` deletes, and a `defaultBranch` hand-roll. |

## Status legend

| Value | Meaning |
| --- | --- |
| **shipped** | The replacement construct exists in tree and the consumer can migrate to it today. |
| **Phase N pending** | The replacement is designed (or scoped) and lands in the named program phase. |
| **consumer-side composition** | No kit construct replaces it — the capability becomes a composition the consumer writes over shipped pieces. This is an answer, not a gap. |
| **decision pending** | The replacement's package or shape is not yet settled; the row names the open question. |
| **stays local** | Deliberately not absorbed. Policy, domain logic or one tool's layout. |

## Migration warnings (dogfood: savvy-web/systems, then silk-release-action)

Cross-cutting hazards a real adoption hit or flagged — items 1-6 from the
savvy-web/systems round, 7-11 from the silk-release-action rounds (2026-07-26).
Every remaining migration should read these before touching the corresponding
surface; **none of them produce a compile error**, which is the whole reason
they are written down.

1. **`ReleaseTag` defaults to strict SemVer — no `v` prefix — as of
   2026-07-25.** The round-1 finding (unscoped names silently gained
   `cli@v1.2.3` under the inherited default) drove a default flip: all names
   now emit `cli@1.2.3` / `@scope/pkg@1.2.3` uniformly, matching Savvy
   convention with zero options. A consumer whose EXISTING tags carry the
   GitHub-style `v` (or whose tooling requires `v<semver>`) must pass
   `versionPrefix: "v"` explicitly, or its tag names silently change — the
   hazard survives the flip, mirrored. Concrete customer:
   silk-release-action's determine-tag-strategy flow.
2. **`SectionId` keys render into markers verbatim.** Any case-normalization
   (or other canonicalization) that lived in old marker-formatting code must
   move to id *construction*, or emitted markers match nothing on disk —
   `check` reports every section absent and `sync` appends a second copy of
   every managed block beside the untouched original. Silent duplication; only
   a suite that round-trips real files catches it.
3. **Adding env vars to a command goes through `Run.extendEnv`** — bare core
   `ChildProcess.setEnv` strips the parent environment (no `PATH`); see the
   commands package docs.
4. **Kit errors carry structured fields plus a `message` getter, no prose
   `reason`.** An adapter wrapping a kit error into a reason-style consumer
   error is lossy by construction (a rendered message stringified back into a
   structured field). Prefer letting the kit error flow, or match on its
   fields.
5. **A missing `PublishabilityDetector` diagnoses at the consuming
   operation, not at a composite.** The `Workspaces` composites neither provide
   nor require a detector; `R` fails to close wherever the program actually
   asks a publishability question (`VersioningStrategy.detect`), which can be
   far from the layer-wiring site a migrator expects.
6. **`VersioningStrategy.classify({ packages: [] })` is the canonical
   "nothing publishable" value** at fallback call sites — there is no separate
   `empty` constructor.
7. **`Run.text` trims — leading and trailing — and that silently corrupts
   column-oriented output.** `git status --porcelain`'s leading-space status
   column is exactly this shape; a caller that substring-parses `Run.text`'s
   return value reads the wrong path for every entry whose status column was
   a space. Parse fixed-column, whitespace-significant output from
   `Run.collect`'s untrimmed `CommandOutput.stdout` instead.
8. **`upsert(branch, targetHead)` then `commitFiles` closes open pull
   requests.** Between the two calls the branch *is* its PR's base, the diff is
   empty, and GitHub auto-closes a PR in that state — a real consumer lost its
   open release PR to a ~3-second window while the run reported success. Build
   the commit first (`GitCommit.get` → `createTree` → `createCommit`) and
   `GitBranch.upsert` once, straight to the finished sha. Both members'
   TSDoc carries the warning; neither call is wrong alone.
9. **Wire a `PublishabilityDetector` with `Layer.mergeAll`, never
   `Layer.provide`.** Warning 5's companion, and the one that reads as correct:
   because the composites do not *require* a detector, `Layer.provide(detector)`
   satisfies nothing and **discards** it, so the service is absent from the
   result. The `@effected/workspaces@0.9.0` changelog shipped the wrong form
   and a consumer copied it. Merge sideways; provide downward.
10. **`npm run <script> --flag` silently eats the flag.** npm claims post-script
    arguments for itself; the other three managers do not. `LocalExec`'s npm
    `scriptPrefix` is `["npm", "run", "--"]` for exactly this reason — take the
    prefix from `LocalExec.scriptPrefix(launcher)` rather than spelling
    `["npm", "run"]` at a call site.
11. **A language-less `Code` node stringifies as an *indented* block.** Building
    a fenced block through `@effected/markdown` needs an explicit `fenceChar`
    (or a `lang`) on the node, or a formatting pass with
    `MarkdownFormattingOptions.codeBlockStyle: "fenced"`. The default is
    canonical and correct; it is also not what a consumer synthesizing a fenced
    block expects, and nothing fails.

### Breaking shapes from dogfood rounds 1–3 (silk-release-action, 2026-07-26)

Unlike the warnings above, every one of these **does** produce a compile error —
listed so a migrator recognizes it as an intended correction rather than a
regression:

- `PullRequest.listFiles` answers `ReadonlyArray<CommitFile>`, not
  `ReadonlyArray<string>` (path *and* status, matching `changedFiles`).
- `PullRequestInfo` gains required `headSha` / `baseSha`; `CommitSummary` gains
  required `parents`.
- `ArtifactMetadata.createStorageRecord(input)` drops its positional `org` and
  resolves the organization from `Repo` like every other resource method.
- `PublishOutcome.provenanceUrl` is a plain optional `string`, not an `Option`.
- `FrontmatterMissingError` gains a required `reason`
  (`"absent" | "captureDisabled"`).
- `ExecContext` gains a required `scriptPrefix` — relevant only to a consumer
  constructing one by hand rather than through `LocalExec.layerFor` /
  `Workspaces.localExecLayer`.

## Document shape

Each map carries:

1. **Overview** — what the repo is, and its blast-radius summary.
2. **A table per source package consumed** — `@savvy-web/github-action-effects` and `@savvy-web/silk-effects`: old construct, where used, effected replacement, status.
3. **Hand-rolled code the kit absorbs** — local file to effected construct.
4. **Stays local** — what deliberately remains behind.
5. **Open questions** — repo-specific, where any exist.

Paths are repo-relative and given without line numbers on purpose: a path survives an edit, a line number does not.
