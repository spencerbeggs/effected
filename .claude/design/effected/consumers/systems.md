---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 88
related:
  - README.md
  - ../packages/github-references.md
  - ../packages/commands.md
  - ../packages/templates.md
  - ../packages/workspaces.md
  - ../packages/git.md
  - ../packages/config-file.md
  - ../packages/markdown.md
  - ../plugin.md
---

# savvy-web/systems

## Overview

`/Users/spencer/workspaces/savvy-web/systems` is Savvy's tooling monorepo — the CLI, the MCP server, the bundler, the changesets and changelog engines, the templates and the plugin. It occupies a double position in this register: it is the source the kit's GitHub and Actions code came from, and it is now one of the kit's heaviest consumers.

Both halves of that move have completed. `packages/github-action-effects` no longer exists; `packages/silk-effects` kept only what was policy.

## What it exercises

**Nearly the whole monorepo tier.** `packages/silk-effects` alone reaches `commands`, `git`, `github-references`, `glob`, `jsonc`, `markdown`, `package-json`, `templates`, `walker`, `workspaces` and `yaml`; the CLI and MCP server take overlapping subsets, and `tsdown-plugins` drives `npm`, `package-json`, `tsconfig-json` and `workspaces`. It is the kit's most demanding consumer of `@effected/git` and, with silk-update-action, of `@effected/workspaces`.

**The inverted `LocalExec` contract, from both ends.** `@effected/commands` declares the narrow contract and `@effected/workspaces` implements it, which is what keeps a monorepo engine out of a single-package action's bundle. Systems is where both sides are exercised against a real workspace.

**A dependency the kit's own typecheck could not have predicted.** `@savvy-web/silk` needed `@effected/templates` as a **direct** dependency because its inferred public surface names kit types — caught only by a dist-level typecheck, not by per-package `tsc` on source. A package that re-exports kit-typed values acquires a direct dependency on the kit whether or not it imports it by name.

## What moved up, and what stayed

These modules left `packages/silk-effects` for the kit:

| Moved | Now |
| --- | --- |
| Tool discovery and version probing | `ToolDiscovery` over the `LocalExec` seam (`@effected/commands`) |
| Managed file sections | `ManagedSection` plus the pure section document core (`@effected/templates`) |
| Tag strategy and versioning detection | `ReleaseTag` and `VersioningStrategy` — pure values and a total classifier, not services (`@effected/workspaces`) |
| Commit metadata lookups | `GitHubCommit` (`@effected/github`) |
| Three hand-rolled issue-reference grammars | the two shipped dialects plus the new closing-list one ([`@effected/github-references`](../packages/github-references.md)) |

**The last move-up is also the kit's one install-weight extraction.** The grammar already existed in the kit — inside `@effected/github` — and systems' own record of why that was unreachable here still holds: `packages/silk-effects` has zero octokit and is the foundation dependency of three downstream packages, so adopting it would have dragged octokit's whole runtime closure into four installs for a page of regex. The kit extracted it to a pure package instead ([github-references.md](../packages/github-references.md)).

**Adoption reported zero discrepancies against the kit's rulings**, including the drift settlements that overrode the local copies: the canonical closing keywords, a mandatory `#`, and `Refs` as a separate non-closing set. What it did find was additive, was [shipped as follow-ups](../packages/github-references.md#the-companion-surfaces) before the package's first release, and is adopted here now — `parseClosingLists` backs the commitlint closes-trailer rule, `collectReferenceLists` backs the changesets harvester, and `parseBareLines` reads the PR-body region. The one real breakage, `Closes #123, Fixes #456` on a single line, which neither originally shipped dialect read, needed a whole-line trailer workaround downstream; the inline list harvester retired it.

**The changesets pipeline reversed its own refusal, and the reversal is the load-bearing part.** The local markdown service was deleted rather than ported, on the argument that the engine is written against real mdast and would have needed either a rewrite or two conversions and a decode per in-process call. What changed the answer was the `Mdast` bridge plus a **sync** stringifier: `packages/silk-effects/src/changesets/utils/markdown-emit.ts` is now the pipeline's single emit chokepoint, decoding plain mdast trees into `@effected/markdown`'s node classes and serializing through the kit's canonical form — a documented stability commitment the pipeline gets to lean on instead of maintaining. The pipeline stays on `remark-parse` for input and keeps its plugin preset; only emit moved. **A refusal argued on conversion cost is worth re-asking the moment a bridge and a sync primitive both exist**, because both halves of the cost were the `Effect` boundary, not the data model.

One candidate was considered and declined, and it stands:

- **Two-tier config discovery is one tool's layout, not a mechanism.** It stays as two resolver entries' worth of policy rather than becoming a kit member.

## Where the kit's edge sits

- **The changesets engine's policy** — the remark plugins, the markdownlint rules, the categories, the release planner and the changelog generator now standing alone as `@savvy-web/changelog`. The kit owns no changesets package, deliberately; what it took over is the emit boundary, not the vocabulary.
- **Savvy's policy services** — publishability, changeset configuration, the workspace analyzer and Biome schema sync. `@effected/workspaces` supplies the `PublishabilityDetector` contract; silk's answer to it stays here.
- **`packages/templates`** — the template *content*. The mechanism moved up; what Savvy's templates say did not.
- **The turbo and repos subsystems**, the commitlint and lint configuration, and the bundler.

## Open questions

1. **`plugins/silk` has never been surveyed against the kit.** The Actions plugin it used to sit beside was replaced by [this repo's own skills](../plugin.md) and is gone from the marketplace; whether silk's plugin skills should follow their modules up has not been asked.
