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
  at: 2026-10-10T23:08:17Z
  body_sha256: cfc902643edd37064f09d8b75c57ee358f883f448de7ec183fac53ba91043550
---

# Vendored Effect is pinned to the lockfile's tag, not main

## Context

`.repos/effect` is a git submodule of [Effect-TS/effect](https://github.com/Effect-TS/effect) vendored so agents can read Effect v4 source directly instead of guessing from training data (which is v3-shaped and out of date by construction for this project). It is managed by the silk plugin's repos tooling and described by `.repos/config.json`.

## Decision

`.repos/effect` is pinned to the release tag matching the `effect` the lockfile resolves — **not** tracking `main`, and not read from the catalog literal. Under [the exact-lock decision](effect-catalog-locked-exact.md) the literal names one exact release, and the lockfile resolves to it, but the lockfile is still the fact to compare against: it is what is installed. The tag is `effect@<resolved-version>`. Read the current one from `repos_inspect` (`mode:"config"`) or the `ref` field in `.repos/config.json`, and compare it with the `effect` version in `pnpm-lock.yaml`. Re-pinning happens in the same commit as any move of the lockfile's `effect`, via `savvy repos pin effect effect@<resolved-version>` (see [advance the effect pin](../runbooks/advance-the-effect-pin.md)).

## Alternatives rejected

Tracking `main` was rejected. `main` moves ahead of whatever version is actually installed and compiled against. A vendored tree at `main` would let an agent read source and assert a surface exists, with source in hand — and be wrong, because the installed `effect` is an older release that has not yet shipped that surface.

## Consequences

The failure mode a tag-tracked submodule avoids is not a normal "stale docs" failure: it is a failure that *looks* conclusive. An agent citing `.repos/effect` at `main` for a surface that does not exist in the installed release has done exactly what the evidence ladder asks (checked source, not memory) and still produced a wrong answer with high confidence — worse than admitting uncertainty. Pinning to the tag means "the source is on disk" and "the source matches what's installed" are the same fact, checkable by comparing the pin to the lockfile's resolved `effect` rather than trusted separately.

The cost is that every move of the lockfile's `effect` requires a corresponding re-pin, folded into the same commit. With exact catalog pins and the HOLD overrides, a plain install no longer moves the lockfile's `effect` on its own, so a move comes with a catalog edit. A return to caret ranges would make the re-pin easy to miss again, because a fresh resolve could then move the lockfile with no catalog edit to prompt it. An omitted re-pin reintroduces the exact drift this decision exists to prevent.
