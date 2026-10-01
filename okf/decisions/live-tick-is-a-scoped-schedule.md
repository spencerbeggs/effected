---
type: Decision
title: The live view's tick is a scoped Effect schedule, and its frame index comes from Clock
description: "Each run forks Effect.repeat(push, Schedule.spaced(tickMillis)) into its scope and computes the frame index as floor(Clock.currentTimeMillis / tickMillis), replacing the first design's unref'd native timer; the scope bound lets the process exit at once and TestClock drives every frame."
status: draft
tags: [architecture, testing]
sources:
  - id: pinned-by
    resource: ../../packages/cli/__test__/ui/CliUi.live.exit.test.ts
    title: "A real-process check that a live view's scoped tick lets the process exit"
  - id: effect-clock
    resource: ../../.repos/effect/packages/effect/src/internal/effect.ts
    title: "effect 4.0.0-rc.118, internal/effect.ts:6341-6350: the default Clock sleeps on a plain, ref'd setTimeout"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: b62296f069b876c8bb4bc592c896009aa6b0d2f669e8b66776112728c47ee90b
---

# The live view's tick is a scoped Effect schedule, and its frame index comes from Clock

## Context

A spinner needs a frame index that advances without events. The first design
called for an `unref`'d wall-clock `setInterval` computing `floor(Date.now()
/ 80)`, so a forgotten timer could never hold the process open.

A probe measured both.[^pinned-by] v4's default `Clock` sleeps on a ref'd
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
  the probe measured.
- The tick never outlives its run or the view's scope, but while a run is
  mounted its ref'd timer keeps the process alive. A run that never sees its
  terminal event holds the process open until the scope closes, so a host
  must end the stream or close the scope for the process to exit; the
  spec's `unref`'d timer would have let it exit mid-run.

[^pinned-by]: `packages/cli/__test__/ui/CliUi.live.exit.test.ts` (the process exits at once) and `CliUi.live.modes.test.ts` (`TestClock` drives the tick)
[^effect-clock]: `.repos/effect/packages/effect/src/internal/effect.ts:6341-6350`
