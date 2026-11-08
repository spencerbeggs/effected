---
type: Module
title: "@effected/changesets"
description: "Boundary-tier reader for changeset files and .changeset/config.json, plus a release planner held to @changesets/get-release-plan as a test oracle, so the bundler and the kit's tooling stop carrying that package at runtime."
status: draft
kind: package
resource: ../../packages/changesets
tags:
  - release
  - deps
sources:
  - id: issue-1148
    resource: https://github.com/spencerbeggs/effected/issues/1148
    title: "changesets: an @effected/changesets package"
  - id: issue-1131
    resource: https://github.com/spencerbeggs/effected/issues/1131
    title: "workspaces: a reader for pending changeset bumps"
  - id: issue-1255
    resource: https://github.com/spencerbeggs/effected/issues/1255
    title: "changesets: lint rules, pre and snapshot modes, fixed and linked groups"
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-08T17:36:58Z
integrity:
  generated:
    body: 8aa0f08811774047
---

# @effected/changesets

## Purpose

`@effected/changesets` parses changeset files and `.changeset/config.json`, and plans a release from them: which packages a set of pending changesets bumps, to which versions, including the packages bumped only because a dependency moved.[^issue-1148] Each changeset file reads to its file name, its releases and its summary.[^issue-1131] Nothing in the package writes a changeset, versions a package or publishes one.

It exists because `@savvy-web/tsdown-plugins` carries `@changesets/get-release-plan` at runtime to compute next versions, and `catalog:sync` read the plan out of `changeset status --output`. The owner ruled that this package is created on the bundler branch, and that `@changesets/get-release-plan` stays only as a devDependency.[^spec]

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md): the file parsers are pure, and reading a workspace's changesets requires core's `FileSystem` and `Path` in `R`, with the platform layer supplied at the edge. Its runtime dependencies are [`yaml`](yaml.md) for frontmatter, [`semver`](semver.md) for ranges and bumps, [`glob`](glob.md) for `ignore` patterns, and [`workspaces`](workspaces.md) for the packages and dependency edges a plan walks. Each edge follows the [peer discipline](../conventions/peer-dependency-discipline.md).

The changeset lint rules ship from a separate `./lint` entry point, whose [`markdown`](markdown.md) and [`markdown-lint`](markdown-lint.md) edges are **optional peers**. They are peers because a consumer passes the package's `LintRule` instances to its own `MarkdownLint` or `MarkdownlintAdapter`, which is a shared-instance contract. They are optional because a consumer of the planner alone never installs them, and the root entry never imports either, the same layout [`config-file`](config-file.md) uses to keep its codec engines off its root.

`@changesets/get-release-plan` is its **test oracle only**. The planner's answers are compared against it in tests, and it never reaches a published manifest's `dependencies` or `peerDependencies`. A disagreement between the two is a bug in this package until shown otherwise.

## Consumers

- [`@effected/bundler`](bundler.md) computes optimistic next versions for the meta bundle's manifest from the plan. This is the first consumer.
- `catalog:sync`, documented in [the catalog sync interface](../interfaces/catalog-sync-cli.md), reads the release plan through `ReleasePlan.read`.
- [silk-release-action](../consumers/silk-release-action.md) is a planned consumer; it has not adopted the package.

## Release modes

The planner mirrors `@changesets/assemble-release-plan`'s loop: ripple to dependents, hold `fixed` groups together, keep `linked` groups in step, and repeat until none changes anything.[^issue-1255] A grouped member's `oldVersion` is the group's highest current version. `PreState` reads `.changeset/pre.json`. In pre mode each bumped version gains `-<tag>.<n>`, and the changesets an earlier pre-release consumed (under `.changeset/pre/`) are left out. In exit mode those changesets count again and every numbered prerelease completes. Each mode is held by an oracle fixture whose expected plan is the oracle's own answer.

Snapshot versions are not planned. `getReleasePlan` takes no snapshot input, so it cannot serve as their oracle, and a snapshot is a flag on `changeset version` rather than a state the repository is in. The remaining deliberate differences are ruled in `ReleasePlan`'s TSDoc and listed in the package's `CLAUDE.md`. The main one: an older-layout `pre.json` is planned the way the oracle settles on after it has moved the consumed files, changeset ids included, and nothing is written. A version is read as node-semver reads one, so a leading `v` is normalised, and one changesets cannot bump (`=1.2.0`, which only npm's loose parse reads), or a `pre.json` with no tag or an unknown mode, fails typed where the oracle crashes or plans nonsense. The plan carries the changesets it was made from and its pre state, so a changelog writer never re-derives which changesets a pre-release consumed.

## Lint rules

`ChangesetLint` (from `@effected/changesets/lint`) defines the style rules CSH001 to CSH005 once each, as `LintRule`s over kit trees, ported from savvy-web/systems with its messages verbatim. They run in `MarkdownLint` and, through `MarkdownlintAdapter`, in markdownlint-cli2. They are held to the golden corpus that [`markdown-lint`](markdown-lint.md) captured from both of systems' engines. On all 113 inputs they equal systems' markdownlint engine, in both hosts. On the 102 inputs where systems' two engines agree, they also equal its programmatic engine. Where those engines disagree, the rules follow the markdownlint engine. That engine is authoritative, because it is what markdownlint-cli2 and the pre-commit hook enforce. The rules read the kit tree the way it reads micromark tokens: top-level blocks only, text as written, fenced code only, and an item empty unless it holds a paragraph. A test pins each input class where the two systems engines part. One difference is left, and it is markdownlint's parser rather than a rule: it reads a bare `-` after indented code as a paragraph.

[^issue-1255]: Issue 1255, `changesets: lint rules, pre and snapshot modes, fixed and linked groups`.
[^issue-1148]: Issue 1148, `changesets: an @effected/changesets package`.
[^issue-1131]: Issue 1131, `workspaces: a reader for pending changeset bumps`.
[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 8 and 12.
