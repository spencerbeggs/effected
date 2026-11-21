---
id: "0028"
title: "effect/testing: Arbitrary.SampleError and Arbitrary.Exhausted carry a required diagnostics array, and string counterexamples shrink differently"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.5"
detect: ["SampleError", "Arbitrary\\.Exhausted", "_tag: \"Exhausted\"", "replay"]
---

When sampling or a property check runs out of its discard budget, `Arbitrary` now reports the unsupported regex patterns it met and the schema paths they sit at (Effect-TS/effect#10639). Both error shapes gained a required `diagnostics` array.

- **Where a hit constructs a `SampleError` or an `Exhausted` value**, in a test double or a fake runner, add `diagnostics: []`. The compiler finds each one.
- **Where a hit reads the error**, log or assert on `diagnostics`. A probe on both versions sampled a struct whose `id` field carries `isPattern(/^(?=.*[0-9])[a-f0-9]{8}$/u)`, a lookahead the generator cannot compile: both versions fail with `SampleError { generated: 0, discards: 201, seed: 1 }`, and the new one adds `diagnostics: [{ _tag: "UnsupportedPattern", path: ["id"], source: "^(?=.*[0-9])[a-f0-9]{8}$", flags: "u" }]`. `checkEffect`'s `Exhausted` carries the same diagnostic. Generation itself is unchanged: the pattern is still dropped and the sample still exhausts.
- **String counterexamples now shrink by deleting characters anywhere**, and shrinking waits until a property fails (Effect-TS/effect#10401). A recorded string replay token may no longer reproduce its case. Re-record any replay a test pins; a fixed `seed` is unaffected.

Check the installed `Arbitrary` `.d.ts` for the diagnostic's fields. Verify with the typecheck and the property tests.
