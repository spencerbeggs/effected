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
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T15:50:41Z
integrity:
  generated:
    body: c3ab94f01cf00f95
---

# @effected/changesets

## Purpose

`@effected/changesets` parses changeset files and `.changeset/config.json`, and plans a release from them: which packages a set of pending changesets bumps, to which versions, including the packages bumped only because a dependency moved.[^issue-1148] Each changeset file reads to its file name, its releases and its summary.[^issue-1131] Nothing in the package writes a changeset, versions a package or publishes one.

It exists because `@savvy-web/tsdown-plugins` carries `@changesets/get-release-plan` at runtime to compute next versions, and `catalog:sync` reads the plan out of `changeset status --output`. The owner ruled that this package is created on the bundler branch, and that `@changesets/get-release-plan` stays only as a devDependency.[^spec]

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md): the file parsers are pure, and reading a workspace's changesets requires core's `FileSystem` and `Path` in `R`, with the platform layer supplied at the edge. Its runtime dependencies are [`yaml`](yaml.md) for frontmatter, [`semver`](semver.md) for ranges and bumps, [`glob`](glob.md) for `ignore` patterns, and [`workspaces`](workspaces.md) for the packages and dependency edges a plan walks. Each edge follows the [peer discipline](../conventions/peer-dependency-discipline.md).

`@changesets/get-release-plan` is its **test oracle only**. The planner's answers are compared against it in tests, and it never reaches a published manifest's `dependencies` or `peerDependencies`. A disagreement between the two is a bug in this package until shown otherwise.

## Consumers

- [`@effected/bundler`](bundler.md) computes optimistic next versions for the meta bundle's manifest from the plan. This is the first consumer.
- `catalog:sync`, documented in [the catalog sync interface](../interfaces/catalog-sync-cli.md), reads the release plan today through `changeset status --output`.
- [silk-release-action](../consumers/silk-release-action.md) is a planned consumer; it has not adopted the package.

Changeset lint rules are not part of this package yet. They wait on the markdown lint work tracked in issue 1030.

[^issue-1148]: Issue 1148, `changesets: an @effected/changesets package`.
[^issue-1131]: Issue 1131, `workspaces: a reader for pending changeset bumps`.
[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 8 and 12.
