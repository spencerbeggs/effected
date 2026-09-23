---
type: Decision
title: "D3: CliLogger's stderrFrom default flips to All"
description: Every log level now routes to stderr by default, so a CLI's stdout carries only what the program writes with Console.log — a breaking 0.x change closing #716.
status: draft
tags: [architecture, dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: bb9181596967206b0392eaf6f8fb97a07df5af8fbcc9e3f492e3356185d85984
---

# D3: `CliLogger` default `stderrFrom` flips to `"All"`

## Context

`CliLogger.layer`'s `stderrFrom` option currently defaults to `"Error"`:
only `Error` and `Fatal` level log lines route to stderr, and everything
at `Info` and below routes to stdout alongside the program's own
`Console.log` output. That default is wrong for a CLI: `mytool run >
out.json` must carry only the program's intentional output on stdout, and
a diagnostic `Effect.logInfo` call mixed into that stream corrupts a
consumer piping the output into a JSON parser. Silk's own hand-rolled
logger already routes warnings to stdout with the identical bug pattern,
and okfit and schemastore-cli each work around the current default by
routing their own diagnostic logging away from `Effect.log*` entirely
rather than trusting the shared logger.

## Decision

`CliLogger.layer`'s `stderrFrom` option defaults to `"All"`: every log
level, not just `Error`/`Fatal`, routes to stderr unless a consumer
explicitly narrows it. A CLI's stdout is then guaranteed to carry only
what the program writes with `Console.log` — never a log line the program
did not explicitly choose to print as output. This closes #716 and is
recorded as a breaking 0.x change in the changeset.

## Alternatives rejected

**Keeping `"Error"` and documenting the trap.** Rejected — documentation
does not stop the corruption; every consumer that reaches for
`Effect.logInfo` for an ordinary diagnostic message, which is the natural
first instinct, still pollutes stdout by default. The design's own
motivation section lists this exact failure mode as one of the bugs the
kit's current default reproduces.

**Defaulting to `"Warning"`.** Rejected as a half-measure: it would still
let `Effect.logInfo` diagnostics leak to stdout, which is the level a
program's own progress or debug logging most commonly uses, leaving the
corruption path open for the single most likely case.

## Consequences

Any consumer relying on `logInfo` reaching stdout under the old default
changes behaviour once it upgrades. The design's own risk assessment
names the one known consumer that logs through `Effect.log` rather than
`Console.log` — Silk — and notes Silk does not use `CliLogger` today, so
the blast radius at ship time is zero known consumers. `okf/modules/cli.md`
documents the new default in its `CliLogger` section, and the levels
comparison stays ordinal
(`LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom)`), never
string-equality on two hard-coded names, so a level added upstream above
`Fatal` still routes correctly without a code change here.
