---
status: current
module: effected
category: migration
created: 2026-07-25
updated: 2026-07-25
completeness: 85
related:
  - ../../plans/2026-07-25-github-split-master.md
  - ../../plans/2026-07-25-github-split-decisions-log.md
  - ../../plans/2026-07-25-silk-runtime-action-survey.md
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

One document per downstream repository affected by the [github-split program](../../plans/2026-07-25-github-split-master.md). Each map records **what** a repo will eventually replace with `@effected` constructs and **where** that code lives today — the old construct, the paths that use it, the replacement's package and name, and the phase that ships it.

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

## Migration warnings (dogfood round 1, savvy-web/systems)

Cross-cutting hazards the first real adoption hit or flagged. Every remaining
migration should read these before touching the corresponding surface; none of
them produce a compile error.

1. **`ReleaseTag` defaults to a `v` version prefix on unscoped names.**
   `ReleaseTag.scoped` emits `cli@v1.2.3` where Savvy's convention (strict
   SemVer, no prefix) expects `cli@1.2.3`; scoped names are byte-identical. A
   tagging consumer upgrades into silently different tag names. Pass
   `versionPrefix: ""` to match Savvy policy. Concrete customer:
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

## Document shape

Each map carries:

1. **Overview** — what the repo is, and its blast-radius summary.
2. **A table per source package consumed** — `@savvy-web/github-action-effects` and `@savvy-web/silk-effects`: old construct, where used, effected replacement, status.
3. **Hand-rolled code the kit absorbs** — local file to effected construct.
4. **Stays local** — what deliberately remains behind.
5. **Open questions** — repo-specific, where any exist.

Paths are repo-relative and given without line numbers on purpose: a path survives an edit, a line number does not.
