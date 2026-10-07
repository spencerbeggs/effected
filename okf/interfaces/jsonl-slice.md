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
  at: 2026-10-07T19:15:53Z
  body_sha256: 608e36f2eec9b4c61963e476375e9854f58db358ce4ee19ed84953ae70bd2f18
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
scopes, and a time range, plus a byte-offset `cursor` saying where to
resume and an `onInvalid` policy saying what to do with a line that cannot
be decoded — used by every read surface. Every field is optional and the
filters combine with AND; an omitted field does not filter, while an empty
`events: []` or `scopes: []` matches nothing.

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
that persists the last processed envelope's `position.end` resumes with
exactly the unprocessed remainder — no replay of the line it already
handled, no gap. A cursor pointing into the middle of a line skips that
line whole rather than decoding half of it.

### A line that cannot be decoded: `onInvalid`

A journal shared with another writer, or with an older or newer version of
the same application, holds lines this registry cannot decode — not JSON,
not an envelope, an unknown tag, or a payload its schema rejects. `onInvalid`
decides what that means to a reader, and both `query` and `changes` (with
`projection` on top of it) honour it identically:

- `"skip"`, the default, leaves the line out and keeps reading, so a
  journal stays readable past lines this registry does not understand.
- `"fail"` ends the stream with the typed `DecodeError`, after delivering
  every matching envelope that preceded the bad line.

A rejection counts against a slice only if it could have mattered to it:
its frame decoded and matched the slice, or it had no frame to match at
all. A line whose frame decodes but does not match is never decoded
further, so it cannot fail a stream that would not have delivered it,
while an unframeable line counts against every slice. The live path
honours this the same way as the disk path because the hub carries
rejected lines, with their frame when they got that far, alongside
envelopes — each subscriber applies its own slice and its own policy to
them, and the historical and live halves of a resumed subscription can no
longer disagree about a bad line.

### What "filter before decode" actually guarantees

The headline property needs stating honestly, because the structural
guarantee holds on some paths and not others. On the disk paths — the
historical read, and the replay half of a resumed subscription — payload
decode is structurally unreachable for a line the slice does not match:
the frame decodes, the filter runs on envelope fields, and a non-matching
line's payload schema is never invoked. On the live path, the hub carries
fully-decoded lines, deliberately — each one an envelope, or a rejection
carrying its error and, when it got that far, its frame: the writer decodes
its own line once, and the watcher decodes each externally appended line
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

The one abnormal end is a contract breach: when the file is truncated or
replaced beneath the journal, the end-of-stream published to attached
subscribers is a failure exit carrying `JournalResync`, so `changes` and
`projection` fail with it while a later subscription reads the re-seeded
file normally (see the [journal
interface](jsonl-journal.md#process-model-cooperative-writers-always-watching)).

## The read economy

### The bounded tail read is the sanctioned cheap read

There is a real tension between a pure core that takes whole text and the
token-economy contract: a hook that reads the entire journal to answer
"what is the last line" has paid for exactly the history the package
promised it could skip. The sanctioned recipe: probe the size, then read
the last N bytes through the offset read; decode from a newline boundary,
discarding the first partial line in the window unless the window starts at
offset 0; walk back from the end to the last valid envelope with
`Envelope.lastValid`; and if no valid envelope is in the window, step back
to the window before it, each step four times the last up to a clamped
maximum, and retry — a journal whose last valid envelope sits further back
than the initial window is not an error, it is another window, and each
window reads only bytes no earlier one did. A single line longer than the
clamp is read by stepping backward in clamped chunks to the newline before
it, so even that never asks for one oversized window. Every offset the
recipe reports is logical post-BOM, matching every other offset the package
emits.

The service's own current-state surface and every last-valid-line read use
this bounded tail recipe, never a whole-file read — a constraint on the
service, not a suggestion to the consumer. The runtime-free reader claim is
qualified accordingly: "needs no runtime" is unconditional, but "is cheap"
holds only through this recipe.

### The historical read is paged

The historical read behind `query` and behind the replay half of a resumed
subscription reads its region — the cursor to the end of the file, sampled
once — in fixed forward pages. Each page's matching envelopes are emitted
before the next page is read, and the unterminated fragment at a page's end
is carried into the next one rather than decoded in halves. Memory is bounded
by a page plus the longest line, and a consumer that stops early stops the
reading with it. The slice is applied as each page decodes, at the frame,
so a non-matching line's payload is never decoded on the way.

The watcher's gap read — the bytes another writer appended, which an
append or an ingest must publish — pages the same way, so no path in the
package reads a region in one allocation.

The cursor still bounds the total work: a consumer resuming from a persisted
offset reads the remainder, and a cursor-less query reads every byte of the
file once — just never all of it at once. "No operation ever holds the file in
memory" is therefore a property this package has; "no operation reads the
whole file" is not, and a cursor is what buys the second.

Every tail window is clamped to a maximum as a regression fence, since the
historical read once sized a tail window to its whole region. The one thing
allowed past a bound, on either path, is a single line longer than it:
decoding a line needs all of it.
