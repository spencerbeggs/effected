---
type: Convention
title: Observability standards
description: Named spans by default, structured logging at operation boundaries, and the division of responsibility between libraries (instrument) and applications (configure telemetry backends).
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
sources:
  - id: effect-effect
    resource: ../../.repos/effect/packages/effect/src/Effect.ts
  - id: semver-src
    resource: ../../packages/semver/src/SemVer.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: c51b0b5aa8d16cda
---

# Observability standards

- Business and library operations are defined with
  `Effect.fn("operationName")(function* () { ... })` — named spans, stack
  frames, and tracing structure by default.[^effect-effect] Anonymous
  `Effect.gen` everywhere loses tracing structure. `@effected/semver`'s
  `SemVer.parse`, `Range.parse` and `Range.intersect` are all named this
  way.[^semver-src] Use meaningful operation names (`loadUser`,
  `parseRange`), never `helper`, `run` or `process`.
- `Effect.withSpan` for nested sub-operations inside a larger operation;
  `Effect.annotateCurrentSpan({ domainId })` for stable identifiers — no
  large payloads or secrets in an annotation.[^effect-effect]
- Log with `Effect.log` / `logInfo` / `logDebug` / `logWarning` /
  `logError` at operation boundaries with structured values, not
  interpolated strings, and not inside every helper.
- `Effect.fnUntraced` only with a measured overhead justification — it is
  rare and low-level, not a default performance optimization.

## Division of responsibility

Libraries in this repo instrument with `Effect.fn` / `withSpan` / log /
metrics and stay telemetry-agnostic; applications compose
`@effect/opentelemetry` layers (`NodeSdk.layer` and similar) once at the
top level. `@effected` libraries never construct or configure OTel SDK
objects themselves — doing so would bind every consumer to one telemetry
backend regardless of what the application actually wants.

Metrics belong at meaningful boundaries — requests, jobs, retries,
external calls — not per-helper; a metric on every internal function call
adds noise without adding a decision point anyone can act on.

[^effect-effect]: `.repos/effect/packages/effect/src/Effect.ts` —
    `fn`/`fnUntraced` (named-span constructors), `withSpan` and
    `annotateCurrentSpan`.
[^semver-src]: `packages/semver/src/SemVer.ts:230` —
    `Effect.fn("SemVer.parse")`; the same pattern recurs in
    `packages/semver/src/Range.ts` and
    `packages/semver/src/Comparator.ts`.
