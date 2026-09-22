---
type: Decision
title: Vendored Effect is pinned to the catalog tag, not main
description: .repos/effect tracks the release tag matching the effect catalog pin instead of the upstream default branch.
status: draft
tags:
  - architecture
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T20:22:25Z
  body_sha256: 7dadd5d4d9fc15e52b2e95b27430627ef75979b3f30795d39ab25e10cc9d581a
---

# Vendored Effect is pinned to the catalog tag, not main

## Context

`.repos/effect` is a git submodule of [Effect-TS/effect](https://github.com/Effect-TS/effect) vendored so agents can read Effect v4 source directly instead of guessing from training data (which is v3-shaped and out of date by construction for this project). It is managed by the silk plugin's repos tooling and described by `.repos/config.json`.

## Decision

`.repos/effect` is pinned to the release tag matching the `effect` catalog pin in `pnpm-workspace.yaml` (currently `effect@4.0.0-rc.117`) — **not** tracking `main`. Re-pinning happens in the same commit as any catalog advance, via `savvy repos pin effect effect@<new-tag>` (see [advance the effect pin](../runbooks/advance-the-effect-pin.md)).

## Alternatives rejected

Tracking `main` was rejected. `main` on a project still shipping prerelease after prerelease drifts ahead of whatever version is actually installed and compiled against. A vendored tree at `main` would let an agent read source and assert a surface exists, with source in hand — and be wrong, because the installed `effect` is an older prerelease that has not yet shipped that surface.

## Consequences

The failure mode a tag-tracked submodule avoids is not a normal "stale docs" failure: it is a failure that *looks* conclusive. An agent citing `.repos/effect` at `main` for a surface that does not exist in the installed prerelease has done exactly what the evidence ladder asks (checked source, not memory) and still produced a wrong answer with high confidence — worse than admitting uncertainty. Pinning to the tag means "the source is on disk" and "the source matches what's installed" are the same fact, checkable by comparing the pin to `pnpm-workspace.yaml`'s `effect` catalog entry rather than trusted separately.

The cost is that every catalog advance requires a corresponding re-pin, folded into the same commit — an omitted re-pin reintroduces the exact drift this decision exists to prevent.
