---
type: Decision
title: Every default reference time comes from Clock, never new Date()
description: Phase logic reads DateTime.now so TestClock can drive it deterministically; no member reaches for the ambient wall clock directly.
status: stable
tags:
  - architecture
  - testing
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 381efef842ec8198
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 05525b82ab6fad3c
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# Every default reference time comes from Clock, never `new Date()`

## Context

`@effected/runtimes` computes a version's release-lifecycle phase
(current, active, maintenance, end-of-life) relative to "now." A naive
implementation reads the ambient wall clock directly, which makes phase
logic dependent on when a test happens to run and untestable against a
specific reference date without monkey-patching a global.

## Decision

Every default reference time is `DateTime.now`, sourced through Effect's
`Clock` service, so `TestClock` drives phase logic deterministically in
tests. No member calls `new Date()`. Phase is computed as a function of
`(release, schedule, now)` with `now` an explicit parameter — see
[the Node schedule is keyed by release line](runtimes-node-schedule-by-release-line.md) —
which is what makes the reference date substitutable in the first place;
`Clock` merely supplies the production default when a caller does not
pass one.

## Alternatives rejected

**Reading `new Date()` directly at the point of use.** Rejected because
it makes phase logic's result depend on wall-clock time at test-run time
rather than on an injectable value, forcing any test of a
lifecycle-boundary date to either monkey-patch the global `Date`
constructor or accept flakiness as the real calendar crosses a boundary.

## Consequences

A test asserting phase behavior at a specific boundary date (a release
transitioning from active to maintenance, say) advances `TestClock` to
that instant rather than waiting for real time or patching a global. Any
new phase-related member introduced later must take its reference time
through `Clock` or as an explicit parameter, never by calling `new Date()`
directly.
