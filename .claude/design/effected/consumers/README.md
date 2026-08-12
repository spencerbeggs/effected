---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 90
related:
  - ../packages/commands.md
  - ../packages/templates.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/workspaces.md
  - ../packages/markdown.md
  - ../packages/config-file.md
  - ../packages/npm.md
  - ../github-action-canon.md
---

# Consumer register

## Overview

One document per application that consumes the kit from outside this monorepo. Each records **what the application is**, **which kit surfaces it exercises**, and **where the kit's edge sits with it** — the capabilities it deliberately keeps for itself.

These documents exist because the kit's scope is closed by its consumers rather than by its own ambition. A package earns its surface by what a real application asks of it, and the register is where that demand is written down. It is a **register of current relationships**, not a work plan: nothing here is scheduled, and no row waits on anything.

**Every application below runs on the kit today.** `@savvy-web/github-action-effects` — the package the kit replaced wholesale — is absent from every consumer's manifest and no longer exists in savvy-web/systems, and the mechanism half of `@savvy-web/silk-effects` has moved up into `@effected/commands`, `@effected/templates` and `@effected/workspaces`. Verified against the checkouts on 2026-08-12.

**These repositories are read-only from here.** They are surveyed, never modified by work in this monorepo. Where a consumer is not checked out locally, its document says so rather than guessing.

## The consumers

| Repo | Document | What it holds the kit to |
| --- | --- | --- |
| savvy-web/silk-release-action | [silk-release-action.md](silk-release-action.md) | The widest surface, and the only consumer of the supply-chain half: SBOMs, provenance, signing and npm/JSR/GitHub Packages publishing. |
| savvy-web/silk-update-action | [silk-update-action.md](silk-update-action.md) | The monorepo half: catalog and manifest rewriting over `workspaces`, `npm`, `lockfiles` and `runtimes`. |
| savvy-web/silk-runtime-action | [silk-runtime-action.md](silk-runtime-action.md) | The runner-local half, alone: tool installation, the cache ladder, blob storage and the detached-process lifecycle. |
| savvy-web/silk-sync-action | [silk-sync-action.md](silk-sync-action.md) | The GitHub API alone — REST typing, GraphQL documents and config loading, with no subprocess and no supply chain. |
| savvy-web/silk-router-action | [silk-router-action.md](silk-router-action.md) | The smallest action surface: payload reading, one pull-request lookup, and layer wiring. |
| spencerbeggs/claude-code-marketplace-manager | [claude-code-marketplace-manager.md](claude-code-marketplace-manager.md) | Comment-preserving JSONC editing plus the branch-and-pull-request landing path. |
| savvy-web/systems | [systems.md](systems.md) | The source monorepo the kit took its GitHub and Actions code from, and now a heavy consumer in its own right. |

## Document shape

Each register entry carries:

1. **Overview** — what the application does, and where it lives.
2. **What it exercises** — the kit surfaces it depends on, and the ones it is alone in driving.
3. **Where the kit's edge sits** — the capabilities that deliberately stay in the consumer, and why.
4. **Open questions** — where any genuinely remain.

Paths are repo-relative and given without line numbers on purpose: a path survives an edit, a line number does not.

## What adoption taught

Adoption by these applications produced a run of upstream corrections, and the pattern in them is worth more than the list. **Not one adoption reported a missing capability.** Every finding was a *projection* the consumer had to write between two things the kit already owned — OIDC claims to a provenance predicate, check state to a document, a row type to a table — and got wrong in a way that typechecked. Prefer absorbing the projection over documenting the hazard.

The hazards that could not be absorbed are recorded in the owning package's design doc, in its own terms and current tense, rather than duplicated here:

| Hazard | Recorded in |
| --- | --- |
| `ReleaseTag` defaults to strict SemVer — a repo with `v`-prefixed tag history must pass `versionPrefix` | [workspaces.md](../packages/workspaces.md) |
| A missing `PublishabilityDetector` diagnoses at the consuming operation, and wires with `Layer.mergeAll` rather than `Layer.provide` | [workspaces.md](../packages/workspaces.md) |
| `Run.text` trims, which corrupts fixed-column output such as `git status --porcelain` | [commands.md](../packages/commands.md) |
| Package-manager argv differences — notably that `npm run <script> --flag` eats the flag | [commands.md](../packages/commands.md) |
| Resetting a branch and then committing to it closes the branch's open pull request | [github.md](../packages/github.md) |
| A language-less `Code` node stringifies as an indented block, not a fenced one | [markdown.md](../packages/markdown.md) |
| `SectionId` keys render into markers verbatim, so canonicalization belongs at construction | [templates.md](../packages/templates.md) |

What these applications prove a *new* action should look like is a separate question, answered by [github-action-canon.md](../github-action-canon.md) — derived construct by construct from the three that completed the move.
