---
type: Decision
title: Build logs are two append-only journals at the workspace root, derived from a cached per-package issues.json
description: "Every package build appends to .cache/effected/build.jsonl and .cache/effected/issues.jsonl, written with @effected/jsonl and keyed by package, so a watcher has one guessable path; dist/prod/issues.json stays the artifact turbo caches, because turbo cannot restore a shared root file on a cache hit."
status: draft
tags:
  - observability
  - dx
sources:
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
  - id: plan
    resource: ../../docs/superpowers/plans/2026-11-06-bundler-branch.md
    title: "Decisions this plan takes, item 4"
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T15:28:18Z
integrity:
  generated:
    body: c288d2c1c90edc6e
---

# Build logs are two append-only journals at the workspace root, derived from a cached per-package issues.json

## Context

`dist/<target>/issues.json` is load-bearing: the silk plugin's `tsdoc-diagnostics` monitor, the `tsdoctor` agent, the gate-count convention and the constructs generator all read it, with `buildOk` checked first and freshness judged by time. It has to be written on every terminal path, by atomic rename, and declared as a turbo output, so that a cache replay restores it alongside `dist`.[^spec] The owner ruled that logs live at `<root>/.cache/effected/<log-type>.*`, one location every package reads and writes, so that an agentic watcher has a guessable path.[^spec]

Those two facts pull apart. Turbo caches per package and cannot restore a root file on a cache hit, and parallel package builds share that file.[^plan]

## Decision

- **Two append-only journals under the workspace root:** `.cache/effected/build.jsonl` and `.cache/effected/issues.jsonl`, written with [`@effected/jsonl`](../modules/jsonl.md) and keyed by package.
- **A per-package `dist/prod/issues.json` remains the cached artifact,** and the journal is derived from it. The journal is a view for watchers. The package artifact is what a reader trusts for one package's result, and a cache replay restores it where a [clean log alone would prove nothing](../gotchas/turbo-cache-hit-replays-clean-log.md).
- **No initialisation step.** `**/.cache` is already gitignored and `Journal` creates the file, so the pnpm plugin has nothing to set up.

## Alternatives rejected

- **A root JSONC log.** A machine-written summary gains nothing from comments, and one rewritten root document is the worst shape for parallel writers. A journal is append-only and schema-validated.
- **Per-package logs only.** Turbo would be satisfied, but a watcher would have to discover one path per package, which is what the owner's ruling exists to avoid.
- **Moving `issues.json` out of `dist` to the root.** A file outside turbo's outputs reads as "not built" after a cache hit, and its readers would have to move with it.

## Related

- [`@effected/bundler`](../modules/bundler.md) writes both.
- [Build through turbo](../conventions/build-through-turbo-only.md) and [the cache-hit gotcha](../gotchas/turbo-cache-hit-replays-clean-log.md) state how `issues.json` is read.
- [The single build target](one-build-target-from-source-links.md) keeps `dist/prod/issues.json` in place.

[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 5 and 12.
[^plan]: `docs/superpowers/plans/2026-11-06-bundler-branch.md`, the section "Decisions this plan takes".
