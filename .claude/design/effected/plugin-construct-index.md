---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 90
related:
  - plugin.md
  - github-action-canon.md
  - package-setup.md
---

# The plugin's construct index

## Overview

The construct index is the [Claude Code plugin](plugin.md)'s answer to a capability being discoverable only by whoever already knows its name: one generated table per kit package, listing every exported construct with an agent-authored **intent** column, so an agent that knows what it wants but not what it is called can grep for it. It is a subsystem of the plugin with its own generator, data sidecar, executable pin and maintenance loop, which is why it has its own document; [plugin.md](plugin.md#skill-catalog) places it among the skills.

## Why it exists

`effected-packages` routes by package, and a package-level routing map cannot answer "validate NTIA" or "run a binary". That is how a migration comes to declare a surface absent when the kit ships it — the incident class [the action canon](github-action-canon.md#hazards) records as *capability discoverable only by name*. The index is the systemic fix: construct-level discoverability by intent, over the full kit rather than a hand-picked subset.

## The artifact

One generated file per workspace package at `plugins/claude-code/skills/effected-packages/references/constructs/<pkg>.md`. Each is a table — **construct | kind | purpose | intent keywords** — under a generated/do-not-edit header. Purpose is the TSDoc summary, mechanically extracted; intent keywords are agent-authored. The doc models expose the full `export declare` surface, and api-extractor's synthesized `X_base` members are filtered whenever the sibling `X` is exported.

The committed output is a fixed point of the pre-commit markdown fix pass: empty cells render in markdownlint's compacted form and the intent column is pipe-escaped, so the hook has nothing to rewrite.

**No new plugin skill.** The hand-written `effected-packages/SKILL.md` carries a "Search by intent" section teaching agents to grep the constructs directory, and its frontmatter routes construct searches.

**Cross-package contract↔implementation pairs render as explicit rows in both packages' files.** The generator inverts each `implements` link into the contract side's file — `ActionsIdentityToken` implements `sbom.IdentityToken`, `Workspaces` implements `commands.LocalExec`, and `WorkspaceCatalogs` / `WorkspaceDiscovery` implement `npm.CatalogResolver` / `npm.WorkspaceResolver` — so a reader landing on either side sees the other.

## Data model and generator

Intent keywords and cross-links live in a sidecar, `plugins/claude-code/scripts/construct-annotations.json` — plain JSON rather than JSONC so the generator needs no parser dependency — keyed package → construct, holding the intent-keyword string plus an optional `implements` field. The `implementedBy` side is never authored; the generator derives it by inverting the `implements` links. Intent strings are short and emphasis-active tokens are code-spanned so the markdown stays inert.

The generator is **dependency-free**: `plugins/claude-code/scripts/generate-constructs.mts`, run with bare Node, parses each package's api-extractor doc model as plain JSON — it does **not** use `@microsoft/api-extractor-model`, which is only in the tree transitively and would need a new devDep. Its CLI is `generate` / `check [--require-intent]`, with exit codes 0/1/2: ok, annotation problems, missing doc models.

The canonical doc-model input is the package build output, `packages/<dir>/dist/prod/npm/meta/<dir>.api.json`, produced by `pnpm build --filter @effected/<dir>` — authoritative on exports, carrying kind, release tag and TSDoc. The copies under `website/lib/models/` are secondary gitignored artifacts and are not read: among other things they can carry stale directories for packages that no longer exist. The generator enumerates packages **by reading the `packages/` directory on disk** — subdirectories containing a `package.json` — never from a models directory. Rendering is deterministic: facts from the doc model joined with the annotations.

## Coverage bar

Class, Function and Variable entries **require** an intent annotation — a missing one is a `check --require-intent` failure naming the construct. Interface and TypeAlias rows ride on their TSDoc summary alone, and annotating them is optional. The rationale: every documented discoverability miss was a value-level capability.

## Enforcement

`plugins/claude-code/__test__/construct-index.bats` pins the index: fixture tests for the generator, a repo drift test that regenerates the committed index into a temp dir and diffs, and the strict `check --require-intent` test. A `setup_file()` hook self-provisions missing doc models by running `pnpm build`, triggered by the generator's exit code 2, so the org release-validate workflow's auto-discovered Shell Tests check needs no custom build step. The rest of the bats suite is described in [plugin.md](plugin.md#what-the-bats-suite-pins).

## Maintenance

A **project-level** skill at `.claude/skills/constructs` — a sibling to [`improve`](plugin.md#the-improve-skill), and outside the plugin for the same reason — documents the build → check → annotate → regenerate loop. A PR adding an export gets a one-row increment, prompted by the failing check.

## Accepted trade-off

The doc-model input adds a build dependency to the check, where a grep-over-`src` approach would have none — accepted because turbo caching makes builds cheap, and the doc model eliminates the source-parsing fragility class and provides TSDoc for free.
