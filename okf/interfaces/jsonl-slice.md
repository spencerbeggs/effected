---
type: Interface
title: "@effected/jsonl read surfaces"
description: Slice, the one filter shape every read surface takes; the consumption model built on it; and the read economy that motivates the whole package.
status: stable
kind: api
resource: ../../packages/jsonl/src/Slice.ts
tags:
  - architecture
  - performance
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: cd784c7d451cdcdbd6779963f76d4818e69ba7850d48c135549e8286a8cdc1ab
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:38.223Z
---

# `@effected/jsonl` read surfaces

The read surfaces are the read half of the [jsonl module](../modules/jsonl.md):
`Slice`, the one filter vocabulary every read takes; the consumption model
built on it — a live stream, a finite query, a resumable cursor and a fold;
and the read economy that motivates the whole package. The append path, the
write lock and the watcher that makes a live stream live belong to the
[journal interface](jsonl-journal.md); what stays here is what a reader may
ask for and what that question costs.

## Slice: the shared read vocabulary

`Slice` (`packages/jsonl/src/Slice.ts`) is one filter shape — events,
scopes, and a time range, plus a byte-offset cursor where resumption
applies — used by every read surface:

| Surface | Shape | Use |
| --- | --- | --- |
| `changes(slice?)` | live `Stream` | Subscribe to one writer's events and not another's. |
| `changes` with a cursor | replay then tail | Resume from a persisted cursor and continue live through the same filter — one seam, not two APIs. |
| `query` | finite `Stream` | Historical read with the same shape as the live one. |
| `projection` | folded state | A per-scope state machine over a shared file: the fold only ever sees its own slice. |

Three properties make this more than a convenience. Filtering happens on
envelope fields, so a neighbour's payload is never decoded on your behalf
(precisely, see [what filter-before-decode
guarantees](#what-filter-before-decode-actually-guarantees)). Typed
narrowing: naming events narrows the stream's element type to those
envelope variants, so a projection over a slice is exhaustively checkable.
And one vocabulary means one thing to learn — a consumer who can express a
subscription can express a query and a projection without translating.

Both range axes are half-open, for tiling: the lower bound is inclusive,
the upper bound exclusive, so adjacent windows tile without
double-delivery — timestamp collisions are not exotic here, since at
millisecond resolution they are common and under `TestClock` several
appends routinely share an identical stamp, so a closed upper bound would
double-deliver constantly in exactly the tests meant to prove correctness.
A cursor compares at-or-after against a line's start offset, so a consumer
that persists the last processed envelope's *end* offset resumes with
exactly the unprocessed remainder — no replay of the line it already
handled, no gap.

### What "filter before decode" actually guarantees

The headline property needs stating honestly, because the structural
guarantee holds on some paths and not others. On the disk paths — the
historical read, and the replay half of a resumed subscription — payload
decode is structurally unreachable for a line the slice does not match:
the frame decodes, the filter runs on envelope fields, and a non-matching
line's payload schema is never invoked. On the live path, the hub carries
fully-decoded envelopes, deliberately: the writer decodes its own line
once, because a frame-carrying hub would instead push payload decode into
*every* subscriber, strictly worse the moment there is more than one.

The property, stated so it is true on every path: a consumer never pays for
a neighbour's payload on any read it performs; a writer pays once for its
own line; and each process pays at most once per line entering it through
the live path.

## Consumption model

`Stream` is the single canonical return type of every slice surface. A
default queue surface was considered and rejected: it would force one
buffering policy on every consumer, when the right policy is a property of
the consumer and not of the journal (a dashboard wants latest-wins, an
auditor wants lossless); it loses stream composition and typed completion,
since quiescence would arrive as a sentinel in the error channel rather
than as the end of a stream; and it drops the typed-narrowing property,
since the combinators that make an event filter narrow the element type
are stream combinators. Queue-style consumption remains one line away
through core interop, with the consumer choosing the buffering policy —
for example converting to a sliding-strategy queue for a latest-wins
display.

The journal's internal hub is bounded with backpressure. The journal never
drops an envelope on behalf of a slow subscriber: slowness propagates to
the producer side, where it is visible, rather than being resolved by a
silent gap in somebody's subscription. A consumer that genuinely prefers
dropping to waiting expresses that in its own queue strategy.

### Quiescence is a published end-of-stream, not a hub shutdown

Two properties this design leans on do not fall out of a plain hub. A
stream over a raw hub has no termination signal — it runs until
interrupted. A hub *shutdown* interrupts subscribers, which is exactly the
tear a graceful-shutdown rule forbids, and an interrupted subscriber is
indistinguishable from a crashed one. So the hub carries `Take` chunks,
end-of-stream is published as an `Exit`, and subscriber streams are built
with a take-aware stream constructor that interprets that exit as the end.
Quiescence and graceful shutdown then arrive at every subscriber as a
normal, typed stream end.

A derived requirement is pinned: subscribing to an already-quiescent
journal must terminate, not hang — a done-exit published before a
subscriber attached is invisible to that subscriber, since a hub has no
replay. Termination is per-subscriber, not a hub-wide replay: a
subscription ends its own stream on seeing a terminal envelope, taken from
the *unfiltered* stream so that a slice which excludes the terminal event
still ends rather than hanging forever on a journal that is over; and a
quiescent check at subscribe time ends the stream immediately for a late
subscriber. Replaying the terminal exit was rejected, since it would
duplicate envelopes for live subscribers, and a hub-wide exit would
permanently end already-attached subscribers, making `reopen` unrepresentable
for them. One pin: a subscriber whose slice matches the terminal event
receives it, then ends — termination must not swallow the envelope that
caused it.

## The read economy

### The bounded tail read is the sanctioned cheap read

There is a real tension between a pure core that takes whole text and the
token-economy contract: a hook that reads the entire journal to answer
"what is the last line" has paid for exactly the history the package
promised it could skip. The sanctioned recipe: probe the size, then read
the last N bytes through the offset read; decode from a newline boundary,
discarding the first partial line in the window unless the window starts at
offset 0; walk back from the end to the last valid envelope; and if no
valid envelope is in the window, widen it and retry — a journal whose last
line is longer than the initial window is not an error, it is a bigger
window. Every offset the recipe reports is logical post-BOM, matching every
other offset the package emits.

The service's own current-state surface and every last-valid-line read use
this bounded tail recipe, never a whole-file read — a constraint on the
service, not a suggestion to the consumer. The runtime-free reader claim is
qualified accordingly: "needs no runtime" is unconditional, but "is cheap"
holds only through this recipe.

### The historical read is cursor-bounded, not window-bounded

Only the current-state and last-valid-line reads are window-bounded. The
historical read behind `query` and behind the replay half of a resumed
subscription reads its requested region in one allocation, bounded by the
file size rather than by any window, and buffers matching envelopes before
emitting, so the stream it returns is fed from a materialized batch rather
than produced incrementally. Its only bound is the cursor: a consumer
resuming from a persisted offset pays for the remainder, and a cursor-less
query over a large journal pays for the whole file.

The consequence, without softening: "no operation ever holds the file in
memory" is not a property this package has. The token-economy contract
holds for the surfaces it was measured on — current state, the hook path,
and any read carrying a cursor — and a cursor-less historical read is the
exception rather than a rounding error in the claim. A paged historical
read (emitting per window, carrying an unterminated tail across the window
boundary) is a known fix that is not built.
