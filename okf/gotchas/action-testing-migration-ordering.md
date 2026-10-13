---
type: Gotcha
title: Converting doubles and the test runner together rewrites the gate alongside what it gates
description: A passing test suite during a migration is the characterization gate proving behavior did not change — swapping the runner in the same step changes what "passing" means, so a still-green suite no longer proves anything.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - testing
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 750e790e6bb4c6b2
---

# Converting doubles and the test runner together rewrites the gate alongside what it gates

## What a reader sees

A migration PR converts an action's test doubles to the kit's own
patterns (real detectors, `@effected/memfs`, recording wrappers over
`ChildProcessSpawner`) and switches the test runner or clock model in the
same commit, and the suite still reports green afterward.

## What they would wrongly conclude

That the green suite confirms the migration preserved the action's
behavior, because it is the same suite that was green before the change.

## What is actually true

The passing suite *before* a migration is the characterization gate: its
job is to prove the migrated code behaves the same as the code it
replaces. Converting the runner at the same time — for instance, moving
onto `it.effect`, which installs a `TestClock` starting at the epoch —
changes what the suite is actually asserting mid-migration. A suite that
stays green through that change has not verified equivalence; it has
verified that the *new* assertions pass against the *new* runner, which
is a different and much weaker claim. The gate and the thing it gates
cannot be rewritten in the same step without losing the gate's value.

## The check

Sequence a testing migration in two separate steps: convert the doubles
first, with the existing runner still in place, and confirm the suite
stays green under the old runner before touching it. Convert the runner —
and accept whatever new time-model or assertion-shape consequences come
with it — as a second, separate change. If both changes land in one
commit, treat the resulting green suite as unproven rather than as
confirmation.
