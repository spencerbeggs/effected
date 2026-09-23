---
type: Consumer
title: savvy-web/systems
description: Savvy's tooling monorepo — CLI, MCP server, bundler, changesets/changelog engines, templates and plugin — the source the kit's GitHub and Actions code came from and now one of the kit's heaviest consumers.
repository: savvy-web/systems
status: stable
tags: [bundle, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:36:08Z
  body_sha256: 83c3f020c2a5efd70ab8eab63a12db995dd473d955dedba799617020c6fc675a
---

# savvy-web/systems

`savvy-web/systems` occupies a double position in this register: it is the
source the kit's GitHub and Actions code was ported from, and it is now one
of the kit's heaviest consumers of the result. Both halves of that move are
complete — the repository's own `packages/github-action-effects` no longer
exists, and `packages/silk-effects` kept only what stayed policy. Verified
against the checkout at `/Users/spencer/workspaces/savvy-web/systems`,
2026-09-02.

## What it exercises

Nearly the whole monorepo tier. `packages/silk-effects` alone reaches
[`@effected/commands`](../modules/commands.md), [`git`](../modules/git.md),
[`github-references`](../modules/github-references.md),
[`glob`](../modules/glob.md), [`jsonc`](../modules/jsonc.md),
[`markdown`](../modules/markdown.md), `package-json`,
[`templates`](../modules/templates.md), `walker`,
[`workspaces`](../modules/workspaces.md) and [`yaml`](../modules/yaml.md);
its CLI and MCP server take overlapping subsets, and its `tsdown-plugins`
package drives `npm`, `package-json`, `tsconfig-json` and `workspaces`. It
is the kit's most demanding consumer of `@effected/git` and, together with
the `silk-update-action` consumer, of `@effected/workspaces`.

It exercises the inverted `LocalExec` contract from both ends:
`@effected/commands` declares the narrow contract and
[`@effected/workspaces`](../modules/workspaces.md) implements it, which is
what keeps a monorepo engine out of a single-package action's bundle.
`systems` is where both sides run against a real workspace rather than a
fixture.

It also surfaced a dependency the kit's own typecheck could not have
predicted: `@savvy-web/silk` needed `@effected/templates` as a direct
dependency because its inferred public surface names kit types, caught
only by a dist-level typecheck rather than by per-package `tsc` on source.
A package that re-exports a kit-typed value acquires a direct dependency
on the kit whether or not it imports the kit by name.

## What moved up, and what stayed

These capabilities moved out of `systems`' own `packages/silk-effects` and
into the kit as this consumer adopted them:

- Tool discovery and version probing → `ToolDiscovery` over the
  `LocalExec` seam ([`@effected/commands`](../modules/commands.md)).
- Managed file sections → `ManagedSection` plus the pure section-document
  core ([`@effected/templates`](../modules/templates.md)).
- Tag strategy and versioning detection → `ReleaseTag` and
  `VersioningStrategy`, pure values and a total classifier rather than
  services ([`@effected/workspaces`](../modules/workspaces.md)).
- Commit metadata lookups → `GitHubCommit`
  ([`@effected/github`](../modules/github.md)).
- Three hand-rolled issue-reference grammars → the two shipped dialects
  plus a closing-list dialect
  ([`@effected/github-references`](../modules/github-references.md)).

The last of these is the kit's one install-weight-driven extraction: the
grammar already existed inside `@effected/github`, but
`packages/silk-effects` has zero octokit dependency and is the foundation
of three downstream packages in `systems`, so adopting `github` directly
would have dragged octokit's runtime closure into four installs for a page
of regex. The kit extracted the grammar to a pure package instead.

Adoption reported zero discrepancies against the kit's grammar rulings —
the canonical closing keywords, the mandatory `#`, and `Refs` as a
separate non-closing set. What it did find was additive and was folded in
before the package's first release: `parseClosingLists` now backs a
commitlint closes-trailer rule, `collectReferenceLists` backs a changesets
harvester, and `parseBareLines` reads a PR-body region. The one real
breakage this loop found — `Closes #123, Fixes #456` written on a single
line, which neither originally shipped dialect read — had needed a
whole-line trailer workaround downstream; the inline list harvester
retired that workaround.

The changesets pipeline's markdown emit is a second reversal worth
recording as a pattern: `systems` had previously declined to port its
local markdown service on the argument that the changesets engine is
written against real mdast and porting would cost either a rewrite or a
conversion-and-decode on every in-process call. What changed the answer
was a bridge between plain mdast trees and
[`@effected/markdown`](../modules/markdown.md)'s node classes, plus a
**synchronous** stringifier: `packages/silk-effects/src/changesets/utils/markdown-emit.ts`
is now the pipeline's single emit chokepoint, decoding into the kit's node
classes and serializing through its canonical form. The pipeline still
parses with `remark-parse` and keeps its own plugin preset; only emit
moved. A refusal argued on conversion cost is worth re-asking the moment a
bridge and a sync primitive both exist, because both halves of the
original cost were the `Effect` boundary, not the data model.

One candidate was considered and declined: two-tier config discovery is
judged to be one tool's layout rather than a mechanism, and stays as
policy in `systems`' own resolver rather than becoming a kit member.

## Where the kit's edge sits

- The changesets engine's policy — remark plugins, markdownlint rules,
  categories, the release planner and the changelog generator (now
  `@savvy-web/changelog`) all stay in `systems`. The kit owns no
  changesets package deliberately; what it took over is the emit
  boundary, not the vocabulary.
- Savvy's own policy services — publishability, changeset configuration,
  the workspace analyzer and Biome schema sync. `@effected/workspaces`
  supplies the `PublishabilityDetector` contract; `systems` supplies its
  own answer to it.
- `packages/templates`' template *content*. The mechanism
  (`ManagedSection`) moved up; what the templates say did not.
- The turbo and repos subsystems, the commitlint and lint configuration,
  and the bundler.

## Open questions

- `plugins/silk` has never been surveyed against the kit. The Actions
  plugin it used to sit beside was replaced by this repository's own
  Claude Code plugin skills and is gone from the marketplace; whether
  `silk`'s plugin skills should follow their modules up into the kit has
  not been asked.
- Its CLI (`packages/cli/src/main.ts`) has no `reportFailures` call at
  all, and carries 49 raw `process.exitCode` writes across
  `packages/cli/src` in its place, one of the widest hand-rolled
  exit-code surfaces this register has surveyed.
- Its warnings print on stdout rather than stderr, unlike the
  stderr-routed convention `@effected/cli`'s `CliLogger` establishes.
- An empty `NO_COLOR` is treated as set — `packages/bundler/src/run.ts`
  and both `tsdown-plugins`/`bundler` `savvy.build.ts` files check
  `process.env.NO_COLOR !== undefined`, so `NO_COLOR=""` disables colour
  the same as `NO_COLOR=1`, the mirror image of the `NO_COLOR !== "1"`
  bug found in `okfit`.
- It carries a byte copy of okfit's MCP remediation helpers — the same
  near-duplication a future `@effected/mcp` `Remediation`/`ToolFailure`
  primitive would collapse across all three of this register's MCP
  server consumers.
