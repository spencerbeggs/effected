---
type: Decision
title: The live view's tick is a scoped Effect schedule, and its frame index comes from Clock
description: "Each run forks Effect.repeat(push, Schedule.spaced(tickMillis)) into its scope and computes the frame index as floor(Clock.currentTimeMillis / tickMillis), replacing the spec's unref'd native timer; the scope bound lets the process exit at once and TestClock drives every frame (probe L7)."
status: draft
tags: [architecture, testing]
sources:
  - id: p5-probes
    resource: ../../docs/superpowers/specs/2026-10-01-p5-probes.md
    title: "P5 planning probe L7: the tick"
  - id: effect-clock
    resource: ../../.repos/effect/packages/effect/src/internal/effect.ts
    title: "effect 4.0.0-rc.118, internal/effect.ts:6341-6350: the default Clock sleeps on a plain, ref'd setTimeout"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T09:47:15Z
  body_sha256: 997bc9ae7ebb91dc355a85cb6247122986140828c6a9bde209d95b59580056ba
---

# The live view's tick is a scoped Effect schedule, and its frame index comes from Clock

## Context

A spinner needs a frame index that advances without events. The design spec
called for an `unref`'d wall-clock `setInterval` computing `floor(Date.now()
/ 80)`, so a forgotten timer could never hold the process open.

Probe L7 measured both.[^p5-probes] v4's default `Clock` sleeps on a ref'd
`setTimeout` with no `unref` option,[^effect-clock] so an Effect tick forked
outside any scope held the process open past its stream. Forked with
`forkScoped` into the scope that drains the stream, it was interrupted with
that scope and the process exited at once. `TestClock.adjust` drove the
Effect tick frame by frame; it could not drive a `setInterval` at all, and
`Date.now()` stayed real time under it.

## Decision

- Per run, fork `Effect.repeat(push, Schedule.spaced(tickMillis))` into the
  run's scope (`tickMillis` defaults to 80), and interrupt it at the
  terminal event and when the scope closes.
- Compute the frame index as `Math.floor(now / tickMillis)` with `now` from
  `Clock.currentTimeMillis`, never `Date.now()`. It keeps counting across
  remounts and is deterministic under `TestClock`.
- Teardown idempotence comes from scope finalizers, not from `unref`.

## Alternatives rejected

- **An `unref`'d `setInterval`.** It exits cleanly but `TestClock` cannot
  drive it, so a frame test would need real sleeps.
- **An Effect tick forked with `runFork`.** It held the process open in the
  probe: the scope is what bounds it.

## Consequences

- A live view's frames are testable with `TestClock` alone.
- The process exiting promptly depends on the tick being forked into the
  view's scope; a refactor that forks it anywhere else reintroduces the hang
  L7 measured.

[^p5-probes]: `docs/superpowers/specs/2026-10-01-p5-probes.md`, section L7
[^effect-clock]: `.repos/effect/packages/effect/src/internal/effect.ts:6341-6350`
