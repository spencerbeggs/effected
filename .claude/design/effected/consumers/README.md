---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 90
related:
  - reposets.md
  - tsdoctor.md
  - fluency-audit.md
  - ../packages/app.md
  - ../packages/store.md
  - ../packages/cli.md
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

**Every application below runs on the kit today, and every one of them resolves through published `catalog:effected` pins.** `@savvy-web/github-action-effects` — the package the kit replaced wholesale — is absent from every consumer's manifest and no longer exists in savvy-web/systems, and the mechanism half of `@savvy-web/silk-effects` has moved up into `@effected/commands`, `@effected/templates` and `@effected/workspaces`. Verified against the local checkouts on 2026-09-02; the two consumers without a local checkout — reposets and claude-code-marketplace-manager — are recorded as of their last survey on 2026-08-25.

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
| spencerbeggs/reposets | [reposets.md](reposets.md) | The application control plane and the terminal: `app`, `store` and the repository-configuration write surface, from a CLI rather than an action. |
| spencerbeggs/tsdoctor | [tsdoctor.md](tsdoctor.md) | Durable local state at scale, and the pure document tier: `store`, `xdg`, `tsconfig-json`, `markdown` and `package-json` inside a build pipeline. The only consumer to have named a kit package into existence (`schema-org`). |

## Document shape

Each register entry carries:

1. **Overview** — what the application does, and where it lives.
2. **What it exercises** — the kit surfaces it depends on, and the ones it is alone in driving.
3. **Where the kit's edge sits** — the capabilities that deliberately stay in the consumer, and why.
4. **Open questions** — where any genuinely remain.

Paths are repo-relative and given without line numbers on purpose: a path survives an edit, a line number does not.

## Linking a consumer to an unreleased kit

Every dogfood loop begins by pointing a consumer at unpublished builds, and the mechanism for that has one trap worth stating once, because its failure mode is a **green typecheck**.

A plain `link:` — or `file:`, which pnpm resolves as a link for a directory — leaves the linked package resolving `effect` and its `@effected` siblings from the *kit's* tree, putting a second `effect` instance in the process. The visible half is honest: type identity errors, "two different types with this name exist". Chasing that by linking each clashing sibling in turn makes the typecheck pass, which is the trap. The invisible half is runtime — schema class adapters failing across the instance seam, an all-strings table cell coming back a non-string, a large minority of a passing suite failing where the unlinked tree passed everything.

The fix is `file:` **plus `dependenciesMeta.<pkg>.injected: true`**, so pnpm materializes a real copy whose dependencies resolve from the consumer's tree — one `effect`, one of everything, and no sibling overrides at all. Two operational notes travel with it: after changing an injected override the lockfile must be cleaned, because a plain install replays the stale resolution and silently keeps the previous link; and the first install can leave a dangling symlink that a second install materializes.

## What adoption taught

Adoption by these applications produced a run of upstream corrections, and the pattern in them is worth more than the list. **The github-split consumers reported no missing capability between them.** Every finding was a *projection* the consumer had to write between two things the kit already owned — OIDC claims to a provenance predicate, check state to a document, a row type to a table — and got wrong in a way that typechecked. Prefer absorbing the projection over documenting the hazard.

**That pattern is a property of arriving second, not a law**, and [reposets](reposets.md) is where it broke: the first consumer of the application control plane and the first to run at a terminal found genuine absence — a resolver chain, a read-through cache, a UTF-8 codec, decode options, unrepresented route families — and, twice, wrote the missing surface itself for this repo to fold in. **Expect the first consumer of any surface to find absence and later ones to find projections**, and read a projection-only round as evidence that the surface was already shaped by someone else.

**A third shape showed up once surfaces started meeting their *second* environment.** [tsdoctor](tsdoctor.md) arrived at `store`, `yaml`, `markdown` and `package-json` after all four had shipped, and found neither absence nor mis-projection: it found the **option axis** — driver options a durable-SQLite consumer must pass through, a compat mode for a downstream YAML 1.1 resolver, sync primitives beside effectful ones. These are additive by construction and cost the kit nothing to grant, which is the tell. **Absence means the surface was never designed; an option ask means it was designed against one environment.** Neither is a defect in the consumer, and only the first is a defect in the design.

**A fourth shape is a consumer naming a package the kit did not have.** tsdoctor's second loop produced [`@effected/schema-org`](../packages/schema-org.md) — the first dogfood output that was a new kit member rather than an extension of an existing one. The test that made it decidable was **not the consumer count**: it was the shape of the split. The half asked for is defined by an external standard and contains nothing of the consumer's domain, exactly as an extraction's does, so "one consumer" is enough where the boundary is drawn by someone other than that consumer. A general capability wanted by one consumer and shaped by that consumer is the case this does **not** license.

That round also produced a warning about the kit's own instincts, worth carrying into the next vocabulary-shaped package: two of `schema-org`'s central decisions are declining `@effected/*` edges that looked obviously right from the kit's side and were wrong from the vocabulary's. **A standard's ranges are the contract; a neighbouring kit package's grammar is not**, and the pull toward the familiar grammar is strong enough to name.

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
| `Store.layerSqlite` is a parameterized factory and layers memoize by reference, so calling it inline at two provide sites opens the database twice | [store.md](../packages/store.md) |

What these applications prove a *new* action should look like is a separate question, answered by [github-action-canon.md](../github-action-canon.md) — derived construct by construct from the three that completed the move.

## Archived

[fluency-audit.md](fluency-audit.md) records the acceptance gate that ran before any consumer had migrated — five known-bad call sites rewritten against the then-new kit and scored on one bar. It is superseded on both counts: its findings live in the owning packages' docs, and the action canon replaced its rewrites with shipped source. Kept as the record that the gate ran, not as guidance.
