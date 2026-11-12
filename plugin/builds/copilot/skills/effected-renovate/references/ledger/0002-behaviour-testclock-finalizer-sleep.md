---
id: "0002"
title: "effect/testing: TestClock no longer interrupts an uninterruptible finalizer on its first sleep"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.4"
detect: ["TestClock"]
---

A finalizer runs uninterruptibly. Under `TestClock`, the first `Effect.sleep` a fiber made used to start the clock's warning fiber interruptibly, which interrupted a finalizer sleeping on its first use. Its cleanup stopped at that sleep and never finished (Effect-TS/effect#10520). A finalizer that sleeps under `TestClock` now waits for the clock to move, then runs to the end.

A probe on both versions: interrupt a fiber whose `Effect.ensuring` finalizer sleeps one second, then `adjust` the clock by one second. On the old version the cleanup stops at its sleep. On the new one it finishes.

Most matches are unaffected. Narrow the search to tests where a finalizer sleeps: `Effect.ensuring`, `Effect.addFinalizer`, `Effect.acquireRelease`'s release, or a layer's scope closing. Such a test may now need the clock adjusted past the sleep before it awaits the fiber, or it waits forever. A test that asserted the cleanup did not finish was asserting the bug; assert that it finishes. Run the tests that use `TestClock`.
