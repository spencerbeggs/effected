---
type: Decision
title: semver's parse and intersect Results are the primitive
description: SemVer.parseResult, Range.parseResult, Comparator.parseResult and Range.intersectResult hold the engine; their Effect twins derive from them and never re-implement it.
status: stable
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-10-25T14:19:57Z
integrity:
  generated:
    body: 60d008abc13e830c
  verified:
    by: human:spencer
    at: 2026-10-25T20:04:29Z
    content: ead19a0c5dc851d7
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-10-25T20:04:29Z
---

# semver's parse and intersect Results are the primitive

## Context

Every fallible operation in `semver` needs both a synchronous entry point (for callers with no Effect runtime, or on a hot path where spinning one up is wasteful) and an `Effect`-typed entry point (for callers already inside a fiber, who want a named span and Effect's structured-failure ergonomics). Implementing both independently risks the two drifting — a bug fixed in one grammar path but not the other.

## Decision

The synchronous `Result` form is the primitive and holds the actual grammar/engine logic: `SemVer.parseResult`, `Range.parseResult`, `Comparator.parseResult` and `Range.intersectResult`. Each corresponding `Effect` form (`SemVer.parse`, `Range.parse`, `Comparator.parse`, `Range.intersect`) is `Effect.fromResult(...)` wrapping the `Result` twin behind the operation's existing named span, and adds nothing else. This is the kit-wide [sync primitive policy](../conventions/sync-primitive-policy.md) applied to semver specifically.

The matching statics (`Range.satisfies`, `Range.maxSatisfying`, and similar) are **deliberately excluded** from this pattern: they are already plain, total, and `Fn.dual`-based, so producing a `Result` twin for something that cannot fail would be dead API surface with no caller ever needing it.

## Alternatives rejected

Implementing the `Effect` forms independently (re-running the grammar directly inside an `Effect.gen` or similar) was rejected — it invites the two forms drifting whenever one is patched and the other is missed, and it forces every caller, including a synchronous one that only wants to validate a string, to either run an Effect or duplicate the parsing logic themselves.

Adding `Result` twins for the already-total comparison statics was also rejected: a `Result` return type on an operation that cannot fail would misrepresent the function's actual failure surface to callers and add API surface nobody asked for.

## Consequences

A bug in the parsing grammar is fixed in exactly one place (the `Result` primitive) and both entry points inherit the fix simultaneously. Synchronous callers — a hot loop over a large list of version strings, or a caller with no fiber to run an Effect in — never pay for spinning up a runtime just to validate a string. The `Effect` forms remain the right choice for callers already composing effects, since they carry the named span for observability at no extra engine cost.
