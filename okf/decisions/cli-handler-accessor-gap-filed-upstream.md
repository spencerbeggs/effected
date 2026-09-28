---
type: Decision
title: "cli files the Command handler-accessor gap upstream rather than shimming it"
description: Why a missing accessor on effect/cli's Command type is reported to core instead of patched locally.
status: draft
tags: [dx]
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: 74f947a296868ceb7ece2156eedc0024a93291c690afed2825dc95797edab464
---

# cli files the Command handler-accessor gap upstream rather than shimming it

## Context

While building `@effected/cli`'s test surface, a gap surfaced in
`effect/cli`'s `Command` type: there is no supported accessor for
a command's handler, which would otherwise make certain testing patterns
more convenient to write.

## Decision

The gap is filed upstream against core, not shimmed inside
`@effected/cli`. This package's whole claim is that it owns the
*boundary* — presentation over a CLI program — rather than patching the
framework `effect/cli` itself provides.

## Alternatives rejected

- **Shimming the internal accessor locally.** Rejected because it buys a
  testing convenience at the cost of owing maintenance against a moving,
  unstable internal — exactly the kind of implementation-of-core's-contract
  work this package's sibling, `@effected/commands`, is built specifically
  to avoid for subprocess handling.

## Consequences

`@effected/cli`'s test surface works around the gap without touching
`effect/cli`'s internals, and the fix — if and when core ships
one — lands upstream rather than as a local patch this package would then
have to un-shim later.
