---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - jsonl.md
  - jsonl-journal.md
  - ../effect-standards.md
---

# @effected/jsonl — the read surfaces

## Overview

The read surfaces are the read half of [`@effected/jsonl`](jsonl.md): `Slice`, the one filter vocabulary every read takes, the consumption model built on it — a live stream, a finite query, a resumable cursor and a fold — and the read economy that motivates the whole package.

The property they hold in common is that a read is filtered before it is decoded, on [envelope fields](jsonl.md#the-envelope-contract) alone, so a consumer pays for its own slice rather than for the file. The append path, the write lock and the watcher that makes a live stream live are [the write half](jsonl-journal.md); what stays here is what a reader may ask for and what that question costs.

## Slice: the shared read vocabulary

`Slice` is one filter shape — events, scopes and a time range, plus a byte-offset cursor where resumption applies — used by **every** read surface. See `src/Slice.ts`:

| Surface | Shape | Use |
| --- | --- | --- |
| `changes(slice?)` | live `Stream` | Subscribe to one writer's events and not another's. |
| `changes` with a cursor | replay then tail | Resume from a persisted cursor and continue live through the same filter — one seam, not two APIs. |
| `query` | finite `Stream` | Historical read with the same shape as the live one. |
| `projection` | folded state | A per-scope state machine over a shared file: the fold only ever sees its own slice. |

Three properties make this more than a convenience. **Filtering happens on envelope fields**, so a neighbour's payload is never decoded on your behalf ([precisely](#what-filter-before-decode-actually-guarantees)). **Typed narrowing**: naming events narrows the stream's element type to those envelope variants, so a projection over a slice is exhaustively checkable. And **one vocabulary means one thing to learn** — a consumer who can express a subscription can express a query and a projection without translating.

### Boundary conventions

Both range axes are **half-open**, and the reason is tiling:

- **The lower bound is inclusive, the upper bound exclusive**, so adjacent windows tile without double-delivery. Timestamp collisions are not exotic here: at millisecond resolution they are common, and under `TestClock` several appends routinely share an identical stamp, so a closed upper bound would double-deliver constantly in exactly the tests meant to prove correctness.
- **A cursor compares at-or-after against a line's start offset**, so a consumer that persists the last processed envelope's **end** offset resumes with exactly the unprocessed remainder — no replay of the line it already handled, no gap.

Both conventions exist so that the obvious consumer code — record where you stopped, resume from there — is also the correct code.

### What "filter before decode" actually guarantees

The headline property needs stating honestly, because the structural guarantee holds on some paths and not others, and the overclaimed version is falsified by the first person who reads the hub's type.

- **On the disk paths** — the historical read, and the replay half of a resumed subscription — payload decode is **structurally unreachable** for a line the slice does not match. The frame decodes, the filter runs on envelope fields, and a non-matching line's payload schema is never invoked.
- **On the live path** the hub carries **fully-decoded envelopes**, deliberately. The **writer decodes its own line once**; a frame-carrying hub would instead push payload decode into *every* subscriber, which is strictly worse the moment there is more than one.

The property, stated so it is true on every path: **a consumer never pays for a neighbour's payload on any read it performs; a writer pays once for its own line; and each process pays at most once per line entering it through the live path.** The [token-economy motivation](jsonl.md#motivation-the-token-economy-as-an-api-contract) is untouched by that correction, because "the current state of mailbox A costs the tail, not the history" is a statement about a **read**, and reads are exactly where the structural guarantee holds.

## Consumption model

**`Stream` is the single canonical return type of every slice surface.** Queue-style consumption was considered as a default and rejected; it remains one line away through core interop, with the *consumer* choosing the buffering policy:

```ts
const queue = yield* Stream.toQueue(journal.changes(slice), { capacity: 64, strategy: "sliding" });
```

A default queue surface loses three things. It **forces one buffering policy on every consumer**, when the right policy is a property of the consumer and not of the journal — a dashboard wants latest-wins, an auditor wants lossless. It **loses stream composition and typed completion**, since quiescence would arrive as a sentinel in the error channel rather than as the end of a stream and every consumer would have to match on it. And it **drops the typed-narrowing property**, because the combinators that make an event filter narrow the element type are stream combinators.

**The journal's internal hub is bounded with backpressure.** The journal never drops an envelope on behalf of a slow subscriber: slowness propagates to the producer side, where it is visible, rather than being resolved by a silent gap in somebody's subscription. A consumer that genuinely prefers dropping to waiting expresses that in its own queue strategy, which is where the choice belongs. That is what makes "a subscription is either complete or explicitly lossy" a property the package can state, and it is one constructor choice away from being false.

The three consumer postures are therefore **recipes over core primitives, not API surface**: run the slice stream directly for lossless consumption, convert to a sliding-strategy queue for latest-wins displays, or convert to a bounded queue and drain in batches to amortize work across a burst.

### Quiescence is a published end-of-stream, not a hub shutdown

Two properties this design leans on — quiescence arriving as **stream end**, and shutdown completing subscriber streams rather than tearing them — **do not fall out of a plain hub**, and the mechanism has to be named or an implementer will reach for the wrong one:

- A stream over a raw hub has **no termination signal**. It runs until interrupted; there is no value a publisher can send that ends it.
- A hub *shutdown* **interrupts subscribers**, which is exactly the tear the graceful-shutdown rule forbids, and an interrupted subscriber is indistinguishable from a crashed one.

So the hub carries `Take` chunks, end-of-stream is published as an `Exit`, and subscriber streams are built with the take-aware stream constructor that interprets that exit as the end. Quiescence and graceful shutdown then arrive at every subscriber as a normal, typed stream end, and failures ride the same channel instead of needing a second one.

A derived requirement falls out and is pinned: **subscribing to an already-quiescent journal must terminate, not hang.** A done-exit published before a subscriber attached is invisible to that subscriber — a hub has no replay — so a late subscription over a terminated journal would otherwise wait forever for an event that already happened.

**Termination is *per-subscriber*, not a hub-wide replay.** Two mechanisms, both local to the subscription: a subscription ends its own stream on seeing a terminal envelope, taken from the **unfiltered** stream so that a slice which *excludes* the terminal event still ends rather than hanging forever on a journal that is over; and a quiescent check at subscribe time ends the stream immediately for a late subscriber. **Replaying the terminal exit was rejected**: it duplicates envelopes for live subscribers, and a *hub-wide* exit is worse still — it would permanently end already-attached subscribers, making `reopen` unrepresentable for them. The finalizer's exit still owns **shutdown**; these two mechanisms own **quiescence**. One pin: a subscriber whose slice **matches** the terminal event receives it, then ends — termination must not swallow the envelope that caused it.

## The read economy

### The bounded tail read is the sanctioned cheap read

There is a real tension between a pure core that takes *whole text* and the [token-economy contract](jsonl.md#motivation-the-token-economy-as-an-api-contract): a hook that reads the entire journal to answer "what is the last line" has paid for exactly the history the package promised it could skip. The pure core is not wrong to take a string — it is pure, and strings are what pure functions take — but **the recipe for getting that string is part of the design, or every consumer will reach for "read the file".**

The sanctioned recipe, which the hook path and the README must show:

1. Probe the size, then read the **last N bytes** through the offset read.
2. **Decode from a newline boundary**: discard the first partial line in the window, *unless* the window starts at offset 0, in which case it is a real first line rather than a fragment.
3. Walk back from the end to the last valid envelope.
4. **If no valid envelope is in the window, widen it and retry.** A journal whose last line is longer than the initial window is not an error, it is a bigger window.

Every offset the recipe reports is logical post-BOM, like [every other offset the package emits](jsonl-journal.md#a-leading-bom-is-stripped-at-the-service-boundary-not-in-the-core).

Two consequences bind the implementation. **The service's own current-state surface and every last-valid-line read use bounded tail reads, never a whole-file read** — a constraint on the service, not a suggestion to the consumer, carrying the same widening rule. And the runtime-free reader claim is qualified accordingly: **"needs no runtime" is unconditional; "is cheap" holds only through this recipe.** The README may not demonstrate the read path without it, because a `readFileString` plus last-valid-line example would be an honest-looking demonstration of the exact cost this package exists to avoid.

### The historical read is cursor-bounded, not window-bounded

Stated plainly, because the opposite is easy to assume and false. **Only the current-state and last-valid-line reads are window-bounded.** The historical read behind `query` and behind the replay half of a resumed subscription does **not** use the bounded-tail recipe:

- It reads its **requested region in one allocation**, bounded by the file size rather than by any window.
- It **buffers matching envelopes before emitting**, so the stream it returns is fed from a materialized batch rather than produced incrementally.
- Its only bound is therefore the **cursor**: a consumer resuming from a persisted offset pays for the remainder, and a **cursor-less query over a large journal pays for the whole file**.

The consequence, without softening: **"no operation ever holds the file in memory" is not a property this package has.** The token-economy contract holds for the surfaces it was measured on — current state, the hook path, and any read carrying a cursor — and a cursor-less historical read is the exception rather than a rounding error in the claim.

**A paged historical read is the fix and is tracked follow-up work, not shipped.** Its shape is known: emit per window rather than per call, and carry an **unterminated tail** across the window boundary so a line straddling two windows is decoded exactly once. It is written down here so the gap is a scheduled correction rather than a rediscovery.
