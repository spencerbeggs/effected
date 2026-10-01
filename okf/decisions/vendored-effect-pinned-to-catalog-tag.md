---
type: Decision
title: Vendored Effect is pinned to the lockfile's tag, not main
description: .repos/effect tracks the release tag matching the effect the lockfile resolves, not the catalog literal and not the upstream default branch.
status: draft
tags:
  - architecture
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T17:24:58Z
  body_sha256: da0a0590a29c8e243c1b1f9b928bd6499bba1c53ea04f9c2c3a4aa1c76011ef5
---

# Vendored Effect is pinned to the lockfile's tag, not main

## Context

`.repos/effect` is a git submodule of [Effect-TS/effect](https://github.com/Effect-TS/effect) vendored so agents can read Effect v4 source directly instead of guessing from training data (which is v3-shaped and out of date by construction for this project). It is managed by the silk plugin's repos tooling and described by `.repos/config.json`.

## Decision

`.repos/effect` is pinned to the release tag matching the `effect` the lockfile resolves — **not** tracking `main`, and not read from the catalog literal, which is a caret range under [the stable-line decision](effect-catalog-tracks-stable-minor.md) and so names no single release. The tag is `effect@<resolved-version>`. Read the current one from `repos_inspect` (`mode:"config"`) or the `ref` field in `.repos/config.json`, and compare it with the `effect` version in `pnpm-lock.yaml`. Re-pinning happens in the same commit as any move of the lockfile's `effect`, via `savvy repos pin effect effect@<resolved-version>` (see [advance the effect pin](../runbooks/advance-the-effect-pin.md)).

## Alternatives rejected

Tracking `main` was rejected. `main` moves ahead of whatever version is actually installed and compiled against. A vendored tree at `main` would let an agent read source and assert a surface exists, with source in hand — and be wrong, because the installed `effect` is an older release that has not yet shipped that surface.

## Consequences

The failure mode a tag-tracked submodule avoids is not a normal "stale docs" failure: it is a failure that *looks* conclusive. An agent citing `.repos/effect` at `main` for a surface that does not exist in the installed release has done exactly what the evidence ladder asks (checked source, not memory) and still produced a wrong answer with high confidence — worse than admitting uncertainty. Pinning to the tag means "the source is on disk" and "the source matches what's installed" are the same fact, checkable by comparing the pin to the lockfile's resolved `effect` rather than trusted separately.

The cost is that every move of the lockfile's `effect` requires a corresponding re-pin, folded into the same commit. A caret catalog makes this easier to miss, because a plain install can move the lockfile with no catalog edit to prompt it. An omitted re-pin reintroduces the exact drift this decision exists to prevent.
