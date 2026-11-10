---
type: Module
title: "@effected/changesets"
description: "Boundary-tier reader for changeset files and .changeset/config.json, a release planner (snapshots included), release application and changelog assembly as data, each held to its @changesets/* engine as a test oracle, so consumers stop carrying those packages at runtime."
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
  - id: issue-1306
    resource: https://github.com/spencerbeggs/effected/issues/1306
    title: "changesets: a tolerant PendingChangesets read that skips a malformed changeset instead of failing the whole directory"
  - id: systems-request
    resource: ../../.claude/dogfood/savvy-web-systems/2026-11-09-request-adoption-changesets.md
    title: "savvy-web/systems adoption round 1, part 2: items 5 to 9 (snapshot, edits, changelog, config keys)"
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-10T00:29:34Z
integrity:
  generated:
    body: 2b1ec2ad7f8d94ed
---

# @effected/changesets

## Purpose

`@effected/changesets` parses changeset files and `.changeset/config.json`, and plans a release from them: which packages a set of pending changesets bumps, to which versions, including the packages bumped only because a dependency moved.[^issue-1148] Each changeset file reads to its file name, its releases and its summary.[^issue-1131] Nothing in the package writes a changeset, versions a package or publishes one. What `changeset version` would write, manifests, consumed changesets, `pre.json` and changelog text, comes back as data, and the caller does the IO.[^systems-request]

It exists because `@savvy-web/tsdown-plugins` carries `@changesets/get-release-plan` at runtime to compute next versions, and `catalog:sync` read the plan out of `changeset status --output`. The owner ruled that this package is created on the bundler branch, and that `@changesets/get-release-plan` stays only as a devDependency.[^spec]

## Strict and settled reads

`PendingChangesets.read` and `readSync` are all or nothing: the first file that does not read or parse fails the whole read, as `@changesets/*` does, and that is what the planner and `catalog:sync` rely on. `readSettled` and `readSettledSync` read the same files in the same order but skip a bad one, answering `{ changesets, failures }`. Each failure is `{ file, error }`, where `error` is the typed `ChangesetParseError` or `PlatformError`, never a string. They exist for read-only consumers that want a best-effort view of pending bumps, such as a CLI that projects next versions, where one bad file should not hide every other bump.[^issue-1306] A directory that cannot be listed still fails the settled read too, because then it is unknown which files exist.

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md): the file parsers are pure, and reading a workspace's changesets requires core's `FileSystem` and `Path` in `R`, with the platform layer supplied at the edge. Its runtime dependencies are [`yaml`](yaml.md) for frontmatter, [`semver`](semver.md) for ranges and bumps, [`glob`](glob.md) for `ignore` patterns, and [`workspaces`](workspaces.md) for the packages and dependency edges a plan walks. Each edge follows the [peer discipline](../conventions/peer-dependency-discipline.md).

The changeset front-matter lint rules ship from a separate `./lint` entry point, whose [`markdown`](markdown.md) and [`markdown-lint`](markdown-lint.md) edges are **optional peers**. They are peers because a consumer passes the package's `LintRule` instances to its own `MarkdownLint` or `MarkdownlintAdapter`, which is a shared-instance contract. They are optional because a consumer of the planner alone never installs them, and the root entry never imports either, the same layout [`config-file`](config-file.md) uses to keep its codec engines off its root.

`@changesets/get-release-plan`, `@changesets/assemble-release-plan`, `@changesets/apply-release-plan`, `@changesets/changelog-git` and `@changesets/types` are its **test oracles only**: devDependencies whose answers the tests compare against, never in a published manifest's `dependencies` or `peerDependencies`. A disagreement is a bug in this package until shown otherwise, and every deliberate difference is ruled in TSDoc and the package's `CLAUDE.md`.

## Consumers

- [`@effected/bundler`](bundler.md) computes optimistic next versions for the meta bundle's manifest from the plan. This is the first consumer.
- `catalog:sync`, documented in [the catalog sync interface](../interfaces/catalog-sync-cli.md), reads the release plan through `ReleasePlan.read`.
- savvy-web/systems' silk-effects is replacing its `@changesets/*` engine with this package: the planner, snapshot plans, `ReleasePlan.edits` for its preview and apply paths, and `Changelog` under its `@savvy-web/changelog` module.[^systems-request]
- [silk-release-action](../consumers/silk-release-action.md) is a planned consumer; it has not adopted the package.

## Release modes

The planner mirrors `@changesets/assemble-release-plan`'s loop: ripple to dependents, hold `fixed` groups together, keep `linked` groups in step, and repeat until none changes anything.[^issue-1255] A grouped member's `oldVersion` is the group's highest current version. `PreState` reads `.changeset/pre.json`. In pre mode each bumped version gains `-<tag>.<n>`, and the changesets an earlier pre-release consumed (under `.changeset/pre/`) are left out. In exit mode those changesets count again and every numbered prerelease completes. Each mode is held by an oracle fixture whose expected plan is the oracle's own answer.

A snapshot plan (`changeset version --snapshot`) takes a `snapshot` input with the time as a `Date`, so assembly stays pure. Its oracle is `@changesets/assemble-release-plan`'s snapshot argument, which `getReleasePlan` never passes. Two rulings follow `changeset version` rather than the bare engine: pre mode is refused with `SnapshotPreModeError`, and an empty tag or commit is no value. The engine fills an empty `{tag}` with nothing, while `apply-release-plan` reads `""` as "not a snapshot", and the CLI never passes `""` to either. The remaining deliberate differences are ruled in `ReleasePlan`'s TSDoc and listed in the package's `CLAUDE.md`. The main one: an older-layout `pre.json` is planned the way the oracle settles on after it has moved the consumed files, changeset ids included, and nothing is written. A version is read as node-semver reads one, so a leading `v` is normalised, and one changesets cannot bump (`=1.2.0`, which only npm's loose parse reads), or a `pre.json` with no tag or an unknown mode, fails typed where the oracle crashes or plans nonsense. The plan carries the changesets it was made from and its pre state, so a changelog writer never re-derives which changesets a pre-release consumed. `ReleasePlan.read` may be given any directory inside the workspace and climbs to the root as the oracle does; `ReleasePlan.readWithContext` returns the plan with the root, the packages and the config it read, which are what `edits` and `Changelog.entry` take, so a caller never re-discovers them or re-derives the lone-package fallback. A release's `changesets` are changeset ids (`pre/<name>` for a consumed one), as the oracle lists them, and a changeset's summary is trimmed as `@changesets/parse` trims it.

## Release application and changelogs

`ReleasePlan.edits` is `changeset version` as data, held to `@changesets/apply-release-plan` run for real on temporary copies of the fixtures, the whole resulting tree compared. Its result has each manifest's new version and rewritten ranges, the changesets to delete, or in pre mode to move under `.changeset/pre/`, and the `pre.json` left behind. A pre-release consumes a changeset by moving its file and never lists an id in `pre.json`. `@effected/semver`'s `Range` is normalised (sorted comparators, `>=0.0.0` kept) where node-semver keeps the written order, so the edits read the engine's own view through `Range.writtenSetsResult` and `Range.isAny` rather than reconstructing it.

`Changelog.entry` renders a release's block and `Changelog.insert` places it in a `CHANGELOG.md`, as `apply-release-plan` does. They are held to its written files, with `@changesets/changelog-git` as the module and each fixture copy made a git repository so commits resolve. The package takes a `ChangelogFunctions` value, structurally identical to `@changesets/types`' type (a compile-time test holds that both ways), so one module loads under `@changesets/cli` and here. A module's `packageJson` is the dependency's whole manifest as discovery read it, `WorkspacePackage.manifestRecord`, as the oracle hands it. Loading the module, finding commits and formatting the output stay with the caller.

`ChangesetConfig` models `changelog` and `snapshot` as fields, which moved them off `extra`; decoding accepts every shape `@changesets/config` accepts for them.

## Lint rules

`ChangesetLint` (from `@effected/changesets/lint`) ships no house style. It ships style-neutral rules that check only what the changesets tool itself refuses a file for:

- `CF001`: the front matter is present, is YAML, and is a mapping when not empty.
- `CF002`: each key names a package.
- `CF003`: each value is `major`, `minor`, `patch` or `none`.
- `CF004`: only when the workspace's names are given, each named package exists.

`ChangesetLint.defaults` is the first three. A caller adds its own style's rules, or replaces the defaults, through `ChangesetLint.lint`'s options or `MarkdownlintAdapter.rules`.

The defaults are held to `@changesets/parse`. A file it parses fails none of them, and a file it refuses fails one, checked in both hosts. Its reading is looser than a stricter linter's:

- the fence pattern is unanchored;
- an empty block and an empty summary are legal;
- a key is a package name when it is not blank.

savvy-web's changeset rules, CSH001 to CSH005, are savvy-web's house style, and savvy-web owns them. The kit no longer provides them. [`markdown-lint`](markdown-lint.md) keeps their golden corpus and test-only copies as an engine-fidelity corpus: two independent reference engines prove one `LintRule` definition gives byte-identical output in `MarkdownLint` and `MarkdownlintAdapter`.

[^issue-1255]: Issue 1255, `changesets: lint rules, pre and snapshot modes, fixed and linked groups`.
[^issue-1148]: Issue 1148, `changesets: an @effected/changesets package`.
[^issue-1306]: Issue 1306, `changesets: a tolerant PendingChangesets read that skips a malformed changeset instead of failing the whole directory`.
[^issue-1131]: Issue 1131, `workspaces: a reader for pending changeset bumps`.
[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 8 and 12.
[^systems-request]: savvy-web/systems' adoption request, items 5 to 9: snapshot planning, release application as data, changelog assembly with a `ChangelogFunctions` contract, and `changelog` and `snapshot` on `ChangesetConfig`.
