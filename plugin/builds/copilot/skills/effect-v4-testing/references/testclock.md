# Time-dependent logic — `TestClock`

Loaded from `effect-v4-testing`.

**`it.effect` ALWAYS installs a virtual `TestClock`. This is not opt-in.**

## The hang: a small REAL delay anywhere under the test, usually in `src`

The expensive failure is not in the test file. It is a test with **no
`TestClock` reference at all**, quietly relying on a 1–10ms real delay, which
stops advancing under `it.effect` and hangs to the vitest timeout with no
message pointing at the clock. In one conversion every hang came from a file
that never mentions `TestClock` — and **in three of four cases the sleep lived
in `src`, not the test**.

**Any `Effect.sleep`, retry schedule, timeout or polling interval anywhere under
the test — however small — needs either a driven clock or `it.live`.** Grep the
implementation, not only the test:

```text
Effect\.sleep|Effect\.timeout|Schedule\.|Effect\.retry|Effect\.repeat|baseDelay|intervalMs|setTimeout\(
```

If a test hangs for exactly five seconds, suspect wall-clock time first.

**A hang can also come from the test double.** A fake `fetch` that records
`String(init.body)` mangles a byte body into `123,34,…`, which throws in
`JSON.parse`, surfaces as a *transport fault*, gets retried, and hangs the
virtual clock — once as **ten unrelated timeouts**. Decode with
`new Response(init.body).text()`.

## Real async I/O in the effect under test desyncs the drain loop — use `it.live`

Driving the clock only works when everything the effect awaits is *scheduled on
that clock*. An effect that interleaves **real filesystem I/O** with sleeps —
`fs.open` → real await → retry `Effect.sleep` — races `TestClock.adjust`: the
sleep created *after* resuming from the real await is not yet registered when
`adjust`'s drain loop re-checks, so the test hangs or flakes depending on how
the real I/O lands (hit live in a two-latch concurrency test over real file
locks). This is not fixable by adjusting harder:
virtual time cannot know when un-clocked real work will complete. The escape
hatch is **`it.live` for exactly those tests** — real clock, real I/O, one
timeline — placed **outside** the `layer()` block per the `MethodsNonLive`
shape (see [providing-layers.md](./providing-layers.md)). Keep the rest of the suite on `it.effect`; the hatch is per-test,
not per-file.

## …and it starts at the EPOCH, so clock *reads* return 1970

The quiet half: `it.effect` starts the `TestClock` at time zero, so anything
that *reads* the clock computes against **1970-01-01T00:00:00.000Z**. The start
time is source-visible — `TestClock`'s constructor opens with
`let currentTimestamp: number = new Date(0).getTime()` (`TestClock.ts:261`), and
the migration guide describes `TestClock.layer()` as creating an "epoch-based
test clock" — and the downstream consequence is directly observable
(`DateTime.now` inside a bare `it.effect` is exactly the epoch). A CLI
resolved **zero** Node versions because against a 1970 "now" every release was
still unreleased; any TTL or "newer than N days" check inverts. Set the clock
with `TestClock.setTime(...)` whenever the code under test reads time.

## Driving it

```ts
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

it.effect("a sleeping fiber wakes when the clock advances", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.sleep("1 second"));
    yield* TestClock.adjust("1 second");
    yield* Fiber.join(fiber);
  }),
);
```

- `TestClock.adjust(duration)` moves virtual time forward and runs everything
  scheduled up to the new time; `TestClock.setTime(timestamp)` jumps to an
  absolute time. Both return `Effect<void>`. All the time helpers live under the
  **`effect/testing`** subpath — `TestClock`, `TestConsole`, `TestSchema`
  (property generation is `Arbitrary`), not `@effect/vitest`.
- **Do not manually provide `TestClock.layer()` under `it.effect`.** They
  compose — `Clock` is a `Context.Reference` (`Clock.ts:192`), `TestClock.layer()`
  merely sets it via `Layer.effect(Clock.Clock)` (`TestClock.ts:441`), and
  `adjust` (`:514`) resolves its clock through `testClockWith`, which reads
  whatever is ambient: `fiber.getRef(Clock.Clock) as TestClock`
  (`TestClock.ts:477`). Nothing breaks, but drop the provide: a nested TestClock
  captures its `liveClock` at build time (`TestClock.ts:258`), so its "live"
  clock **is** the outer TestClock — `withLive` (`:282`) returns virtual time
  and the too-long-without-advancing warning fiber can never fire.
- **Never call `TestClock.adjust` under `it.live`** — that `as TestClock` cast is
  unchecked, so it is undefined behavior, not a type error. And **a
  clock-driving test must not share a `layer()` group**: `adjust` is cumulative
  across the group's shared clock.

Or **restructure the test to need no time at all**. For an interrupt, prefer a
failing sibling over a timeout — `Effect.exit(Effect.all([subject,
Effect.fail("x")], { concurrency: 2 }))` interrupts the subject clock-free
(`Effect.never` is not clock-backed). Note what that reports: the **sibling's
`Fail`** on the aggregate cause, not the interrupt (`hasFails` true,
`hasInterrupts` false), so asserting `Cause.hasInterrupts` would pass for the
wrong reason. Assert on the *observable consequence* — that the interrupted
resource still works afterward.

**Stage an interleaving with latches, not sleeps** — a sleep under the virtual
clock hangs instead of interleaving — and a *leak* test needs **two** of them. A
single-latch test passes against a save/restore-a-shared-global implementation,
because save/restore is LIFO-correct whenever the overrides nest; the
discriminating shape forces one fiber to READ while the other's override is
applied and unrestored → [false-greens.md](./false-greens.md).
