---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-17
last-synced: 2026-08-17
completeness: 88
related:
  - README.md
  - ../packages/github-references.md
  - ../packages/commands.md
  - ../packages/templates.md
  - ../packages/workspaces.md
  - ../packages/git.md
  - ../packages/config-file.md
  - ../plugin.md
---

# savvy-web/systems

## Overview

`/Users/spencer/workspaces/savvy-web/systems` is Savvy's tooling monorepo — the CLI, the MCP server, the bundler, the changesets engine, the templates and the plugin. It occupies a double position in this register: it is the source the kit's GitHub and Actions code came from, and it is now one of the kit's heaviest consumers.

Both halves of that move have completed. `packages/github-action-effects` no longer exists; `packages/silk-effects` kept only what was policy.

## What it exercises

**Nearly the whole monorepo tier.** `packages/silk-effects` alone reaches `commands`, `git`, `github-references`, `glob`, `jsonc`, `package-json`, `templates`, `walker`, `workspaces` and `yaml`; the CLI and MCP server take overlapping subsets, and `tsdown-plugins` drives `npm`, `package-json`, `tsconfig-json` and `workspaces`. It is the kit's most demanding consumer of `@effected/git` and, with silk-update-action, of `@effected/workspaces`.

**The inverted `LocalExec` contract, from both ends.** `@effected/commands` declares the narrow contract and `@effected/workspaces` implements it, which is what keeps a monorepo engine out of a single-package action's bundle. Systems is where both sides are exercised against a real workspace.

**A dependency the kit's own typecheck could not have predicted.** `@savvy-web/silk` needed `@effected/templates` as a **direct** dependency because its inferred public surface names kit types — caught only by a dist-level typecheck, not by per-package `tsc` on source. A package that re-exports kit-typed values acquires a direct dependency on the kit whether or not it imports it by name.

## What moved up, and what stayed

Four modules left `packages/silk-effects` for the kit:

| Moved | Now |
| --- | --- |
| Tool discovery and version probing | `ToolDiscovery` over the `LocalExec` seam (`@effected/commands`) |
| Managed file sections | `ManagedSection` plus the pure section document core (`@effected/templates`) |
| Tag strategy and versioning detection | `ReleaseTag` and `VersioningStrategy` — pure values and a total classifier, not services (`@effected/workspaces`) |
| Commit metadata lookups | `GitHubCommit` (`@effected/github`) |
| Three hand-rolled issue-reference grammars | the two shipped dialects plus the new closing-list one ([`@effected/github-references`](../packages/github-references.md)) |

**The fifth move-up is also the kit's one install-weight extraction.** The grammar already existed in the kit — inside `@effected/github` — and systems#507 recorded why that was unreachable here: `packages/silk-effects` has zero octokit and is the foundation dependency of three downstream packages, so adopting it would have dragged six runtime dependencies into four installs for forty lines of regex. effected#399 extracted it to a pure package instead. Round-1 adoption reported **zero discrepancies** against the kit's rulings, including the three drift settlements that overrode the local copies (the canonical nine keywords, mandatory `#`, and `Refs` as a separate non-closing set); the three gaps it did find are additive and were filed as effected#402/#403/#404, then [shipped as follow-ups](../packages/github-references.md#the-four-additive-follow-ups) on 2026-08-17, still ahead of the first release. The one real breakage — `Closes #123, Fixes #456` on a single line, which neither shipped dialect read — was worked around downstream by declaring trailers whole-line; `harvestReferenceLists` (#402) removes the need for that workaround whenever systems next touches the call site.

Two candidates were considered and declined, and the reasons are the load-bearing part:

- **The changesets markdown service was deleted rather than ported.** Its `parse`/`stringify` had no real call sites, and the engine behind it is written against real mdast, which reaches the kit only through a bridge. Adopting the kit there would have meant a rewrite, or two conversions and a decode per in-process call.
- **Two-tier config discovery is one tool's layout, not a mechanism.** It stays as two resolver entries' worth of policy rather than becoming a kit member.

## Where the kit's edge sits

- **The changesets engine, entire** — the remark plugins, the markdownlint rules, the categories, the changelog generation and the release planner. The kit owns no changesets package, deliberately.
- **Savvy's policy services** — publishability, changeset configuration, the workspace analyzer and Biome schema sync. `@effected/workspaces` supplies the `PublishabilityDetector` contract; silk's answer to it stays here.
- **`packages/templates`** — the template *content*. The mechanism moved up; what Savvy's templates say did not.
- **The turbo and repos subsystems**, the commitlint and lint configuration, and the bundler.

## Open questions

1. **`plugins/silk` has never been surveyed against the kit.** The Actions plugin it used to sit beside was replaced by [this repo's own skills](../plugin.md) and is gone from the marketplace; whether silk's plugin skills should follow their modules up has not been asked.
