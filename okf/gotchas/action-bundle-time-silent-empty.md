---
type: Gotcha
title: A degraded build-time decode failure reports a truthful-sounding empty result
description: Folding a build-time data decode failure into an empty array with orElseSucceed produces a result that looks like "no versions found" instead of "the bundle is broken", and nothing about the shape of the output tells them apart.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 9842caa5abd81ad5
---

# A degraded build-time decode failure reports a truthful-sounding empty result

## What a reader sees

A build-time data-loading step — decoding a generated manifest or lookup
table at bundle-construction time — returns an empty array, and the
action built on top of it reports something plausible like "no versions
found" without raising any error.

## What they would wrongly conclude

That the empty result reflects a genuine absence in the input data, since
nothing about the output shape distinguishes "the source had nothing in
it" from "decoding the source failed".

## What is actually true

An `Effect.orElseSucceed(() => [])` folded around a build-time decode
turns a broken bundle into an output indistinguishable from a correctly
empty one. One shipped action did exactly this and produced a "no
versions found" result that read as truthful while actually reporting a
decode failure over data the bundle should have carried successfully. A
build-time data-loading failure is not a recoverable runtime condition
with a sensible default — it means the artifact being run is not the one
that was intended to ship.

## The check

Never degrade a build-time data decode failure to an empty or default
value. Let it fail as a defect instead, so a broken bundle is loud at the
point it is first exercised rather than silently indistinguishable from a
correct-but-empty answer. Where a standalone function versus a class
static alias is a choice, prefer the bundle-safe standalone form, since
tree-shaking behavior around class statics is itself a source of
build-time surprises worth eliminating separately.
