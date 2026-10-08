---
type: Gotcha
title: A flaky jsonl watcher is probably an arming-order window, not an unreliable platform watch
description: The instinct to blame the platform file watch as generically unreliable leads to an unjustified polling timer; both real failures this package hit were a catch-up read running before the watch was registered.
status: stable
stale_after: 2027-03-13T00:00:00Z
resource: ../../packages/jsonl/src/internal/engine.ts
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-10-08T06:11:30Z
  body_sha256: 0cf3ca0d2224720ccd004bf8c8c98a0e8c6d143f3b3962569545ef7bb6c88f4f
---

# A flaky `jsonl` watcher is probably an arming-order window, not an unreliable platform watch

## What a reader sees

A `Journal`'s subscription occasionally misses an external append, or a
consumer report describes the watcher as "unreliable" or "flaky" under
load or on some filesystems. In this repository it looked like an
integration test timing out intermittently, and only under CPU load.

## What they will wrongly conclude

That the underlying platform file watch cannot be trusted in general, and
that the fix is a polling fallback timer layered on top of the watch to
paper over its unreliability.

## What is actually true

Both real failures this package hit were ordering, not the platform. The
first was catch-up before arming: the read ran, then the watch was armed,
and a line landing in between waited for the next append. The second was
arming that was only *requested*: the engine forked core's
`FileSystem.watch` and yielded a few scheduler turns, but on Node that
watch runs an asynchronous `stat` and registers in a forked fiber with no
signal, so under load the catch-up read still ran before registration. The
file watch itself delivered every event once it was live. The fix is the
`JournalWatcher` contract — a watch effect that succeeds only once
registered — and the arm, catch-up, follow order on both the file and the
activation path (see the [journal
interface](../interfaces/jsonl-journal.md#the-watcher-and-activation) and
the [arm-before-success
decision](../decisions/jsonl-watch-arms-before-success.md)). A polling
timer would not have closed either window; it would only have shortened
how long the missed line stayed invisible.

Directory watches do misbehave on Node — creation and append both reported
as removal, a bare relative name, and events with no filename at all —
which is why activation treats every element as an untyped poke. Core's
Node watch drops a no-filename event outright; `NodeJournalWatcher`
delivers it as a poke with no name, which the journal treats as possibly
naming the journal.

## The check

Before adding any timer or polling fallback, ask whether the catch-up read
can run before the watch is registered. With a `JournalWatcher` that
honours its contract it cannot, so a custom implementation that resolves
its `watch` effect before the platform watch is live is the first suspect.
If a platform is found to drop events on a watch that *is* registered,
record it as its own Gotcha with the reproduction; that is a defect in that
platform's backend, still not a reason for a timer.
