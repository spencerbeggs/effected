---
type: Gotcha
title: A missing PublishabilityDetector fails far from where it was wired
description: Workspaces composites neither provide nor require a PublishabilityDetector, so a missing one surfaces as an unclosed R at whatever downstream operation asks the publishability question, not at the layer-composition call site — and Layer.provide silently discards a detector instead of wiring it.
status: stable
resource: ../../packages/workspaces/src/Publishability.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
  - release
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 6db5be5d6f184a2b
---

# A missing PublishabilityDetector fails far from where it was wired

## What a reader sees

A consumer composes `Workspaces.layer()` with a custom
`PublishabilityDetector`, using `Layer.provide(detector)` to attach it,
and the composition itself typechecks and builds without complaint. Later,
a call to `VersioningStrategy.detect` (or another operation that asks a
publishability question) fails to close its `R` channel, or a merge order
change silently reverts a custom detector to kit defaults with no error at
all.

## What they would wrongly conclude

That the layer composition succeeded because it compiled, and that the
detector is correctly wired into the workspace pipeline as a result — or,
in the merge-order case, that the custom detector is in effect simply
because it appears in the composition.

## What is actually true

No composite in `@effected/workspaces` provides or requires a
`PublishabilityDetector` — the requirement surfaces only where a program
actually asks a publishability question, in the `R` of operations like
`VersioningStrategy.detect`, which may be far from wherever the layers
were composed. `Layer.provide(detector)` feeds the detector **into** the
composite's requirements; since the composite does not require one, the
provide satisfies nothing and the detector is discarded entirely, taking
the service back out of the resulting layer's output — the program then
fails to close `R` at the distant downstream call, for a reason the
wiring line gives no hint of. Separately, because there is no ambient
default detector for a custom one to shadow, `Layer.mergeAll` is the only
form that composes correctly; an earlier form once resolved to kit
defaults regardless of argument order, and a published changelog shipped
the wrong composition form which a consumer then copied.

## The check

Wire a custom `PublishabilityDetector` with `Layer.mergeAll(detector,
Workspaces.layer())`, never `Layer.provide`.[^publishability] When an
unclosed `R` names a publishability-detector requirement, look for the
composition form first rather than assuming the detector was never built
correctly — the failure's location (a downstream release operation) is
expected to be distant from the actual composition mistake.

[^publishability]: `packages/workspaces/src/Publishability.ts:27-50` —
    documents that no composite provides or requires a detector, that
    `Layer.provide` discards it, and that `Layer.mergeAll` is the correct
    form, citing a published changelog that shipped the wrong one.
