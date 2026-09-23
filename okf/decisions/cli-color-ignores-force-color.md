---
type: Decision
title: "D8: CliColor ignores FORCE_COLOR, matching core"
description: CliColor.enabled reads only Stdio.stdoutIsTerminal and a non-empty NO_COLOR, deliberately leaving FORCE_COLOR unhandled everywhere, consistent with core's own colour decision.
status: draft
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 8ece33ca3827f08d6e9bf90cc3b5aac192c74adcd6c0fc8a0a366edfff1ca9d7
---

# D8: `FORCE_COLOR` is ignored, matching core

## Context

Three consumer rules for colour already disagree with each other and with
the common convention: okfit checks `NO_COLOR !== "1"` instead of mere
presence, so `NO_COLOR=""` or any other truthy-looking value fails to
disable colour; Silk treats an empty `NO_COLOR` value as set, the opposite
bug; and `FORCE_COLOR` is unhandled everywhere, including in core itself.
Designing `CliColor.enabled` invites fixing all three at once, and
`FORCE_COLOR` support looks like an obvious inclusion since many CLI
ecosystems honour it. But core's own colour decision — the one
`CliOutput.defaultFormatter` and the rest of `effect/unstable/cli`
already build on — does not read `FORCE_COLOR`, and diverging from it
here would mean this package's colour behaviour disagrees with the help
text and command output core renders through the same formatter, for
exactly the disagreement `CliColor.formatterLayer`'s single-decision
design exists to prevent.

## Decision

`CliColor.enabled` reads only `Stdio.stdoutIsTerminal` and a non-empty
`NO_COLOR`, via `Config.option(Config.String("NO_COLOR"))` through a
`ConfigProvider` — never `process.env` directly, keeping the check
testable with `ConfigProvider.fromUnknown`. `FORCE_COLOR` is deliberately
never read, matching core's own posture rather than diverging from it.

## Alternatives rejected

**Diverging from core to honour `FORCE_COLOR`.** Rejected — `CliColor.formatterLayer`
builds `CliOutput.defaultFormatter({ colors })` from the same
`enabled` decision specifically so help text, parse errors and rendered
output always agree; if `CliColor` honoured `FORCE_COLOR` while core's own
formatter internals did not, a consumer setting `FORCE_COLOR=1` over a
non-TTY would see this package's own output coloured while core's help
text stayed plain — the identical class of disagreement the three
existing `NO_COLOR` bugs already demonstrate is a real trap, just on a
different variable.

## Consequences

The `NO_COLOR` check is correctly presence-based by construction — `Config.option`
answers `Some`/`None`, not string equality against `"1"` — closing both
the okfit and Silk bugs without special-casing either one.
`okf/modules/cli.md`'s testing section documents the resulting truth
table: `NO_COLOR` values `unset / "" / "1" / "true" / "0"` crossed with
TTY yes/no. A consumer that genuinely needs `FORCE_COLOR` support can add
it at their own call site by overriding `CliColor.formatterLayer`'s
`colors` input directly; the kit does not close that door, it simply does
not open it by default.
