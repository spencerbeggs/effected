---
type: Decision
title: "CliLogger honours LogToStderr only as a force-all override"
description: Why the public LogToStderr reference can only push every level to stderr, never move one level back to stdout.
status: stable
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 3052b9a418e53b9f1e47c58898e0e864b264f00162148074b2e2860e555ed1c9
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# CliLogger honours LogToStderr only as a force-all override

## Context

`References.LogToStderr` is a public reference core's own default logger
already reads to decide its stream. `@effected/cli`'s `CliLogger` also
needs to respect it, but the reference could plausibly be read two ways:
as a single all-or-nothing switch, or as something that could be
interpreted per level.

## Decision

`CliLogger` honours `LogToStderr` as a force-all-to-stderr override and
never as a per-level one. When set, everything goes to stderr; when unset,
the ordinary level-based split decides the stream. A consumer who sets it
meant "this whole program's output is diagnostic" — letting it move `Info`
back to stdout while other levels stayed on stderr would give two
mechanisms deciding one thing.

## Alternatives rejected

- **A per-level interpretation**, where `LogToStderr` shifts the
  stderr/stdout boundary rather than collapsing it. Rejected because it
  would let the reference and `stderrFrom`'s ordinary threshold disagree
  about the same decision, and a reader has no way to predict which one
  wins for a given level.

## Consequences

The rule this package holds to is one-directional and load-bearing:
`LogToStderr` can force stderr, but must never be read as a way to move an
error-level message back onto stdout. That is the one guarantee `CliLogger`
makes, and a future reference addition upstream must not be allowed to
weaken it.
