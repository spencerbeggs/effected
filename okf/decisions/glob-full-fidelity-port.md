---
type: Decision
title: glob is a full-fidelity vendored port, not a minimal runtime dependency
description: @effected/glob vendors the complete minimatch/brace-expansion/balanced-match dialect with attribution rather than taking minimatch as a runtime dependency or shipping a narrowed subset of its dialect.
status: stable
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T20:11:24Z
integrity:
  generated:
    body: 4b78acda9e2d08e4
  verified:
    by: human:spencer
    at: 2026-11-05T20:23:04Z
    content: add51726d1da1f4e
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-11-05T20:23:04Z
---

# glob is a full-fidelity vendored port, not a minimal runtime dependency

## Context

`@effected/glob` needs glob-pattern matching, and an established, widely-used implementation (`minimatch`, plus its `brace-expansion` and `balanced-match` dependencies) already exists on npm. The package is pure-tier, and the kit's pure/boundary dependency rule forbids external runtime dependencies for those tiers. Separately, today's call sites for glob matching in the kit do not exercise every corner of minimatch's dialect (extglobs, POSIX character classes, and similar).

## Decision

`@effected/glob` vendors the **complete** minimatch engine — extglobs, braces, character classes including POSIX classes, true `**` globstar, negation, `#`-comment handling, and the full options surface — as ported, attributed source under `internal/`, rather than taking `minimatch` as a runtime dependency or scoping the port to today's call sites. `minimatch` survives only as an exact-pinned devDependency test oracle, imported solely under `__test__/`.

## Alternatives rejected

**Taking `minimatch` as a runtime dependency** was rejected outright by the pure/boundary tier's dependency rule: an external runtime dependency there is not permitted regardless of how established the upstream package is.

**Scoping the vendored port to today's call sites' dialect** was rejected. The kit's consuming applications have known future uses for glob's broader dialect, so trimming to current call sites would trade a one-time savings for a predictable later expansion — the same reasoning [`toml`](toml-full-parity-from-scratch.md) applied to shipping full format-package parity rather than a parse/stringify-only surface scoped to its first consumer.

**Letting every call site carry its own narrower glob engine** was also implicitly rejected: the anti-drift concern a fixed, narrow dialect would address is solved differently in this package — by everyone sharing **one** full-fidelity engine rather than by offering zero options. `GlobSet` pins fixed semantics internally so consumers needing drift-free behavior get it, while applications that need the full dialect reach it through `GlobPattern`'s options.

## Consequences

The port carries the full upstream dialect's surface area, options, and edge-case behavior, plus vendored-code attribution obligations (every ported file keeps its license header, never edited). Three functional deviations from upstream were made deliberately in the process: no ambient environment detection (`platform` is an explicit option defaulting to `"posix"`, matching the `walker` precedent that a pure library never reads ambient process state), typed budget exhaustion instead of upstream's silent truncation on expansion overflow, and `**` matching that takes minimatch 11.0.4's fixes (and nothing else from that rewrite) where the oracle still has the bugs. All three are recorded so a future maintainer porting an upstream fix does not "restore" any of them by mistake. The trade for shipping the full dialect is a larger vendored surface to keep in sync with upstream security fixes, offset by the oracle-based differential test suite that flags any drift from real `minimatch` behavior outside the three documented deviations (the opt-in `extglobBang` option is an adaptation that is off by default, so it never changes what the oracle compares).
