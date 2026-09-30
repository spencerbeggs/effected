# Asserting on typed errors — defects, narrowing and assert helpers

Loaded from `effect-v4-testing`. The parts of failure-channel testing beyond
`Effect.flip` / `Effect.result` / `Effect.exit`: proving a defect is NOT
laundered into the typed channel, and the assert-helper typing traps.

Genuine defects must NOT be swallowed into the typed channel — that is
what a flip-based test cannot prove (working example:
`packages/toml/__test__/hostile.test.ts` "defect passthrough"):

```ts
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";

class MyTypedError extends Error {}
const original = new Error("unexpected")
const program = Effect.die(original)

it.effect("a defect stays a defect — never laundered into the typed channel", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(program);
    if (!Exit.isFailure(exit)) {
      assert.fail("expected a defect, got a success");
    }
    assert.isFalse(exit.cause.reasons.some(Cause.isFailReason)); // NOT a typed Fail
    const die = exit.cause.reasons.find(Cause.isDieReason);
    assert.strictEqual(die?.defect, original);      // the ORIGINAL error, unmasked
    assert.notInstanceOf(die?.defect, MyTypedError); // not laundered into E
  }),
);
```

The no-Fail-reason line is the discriminating assertion — without it, an
implementation that wraps the defect in a typed error still passes. For the
coarse verdict, `Cause.hasDies` / `Cause.hasFails` are the one-line spellings
(`@effected/git`'s `available` test uses them).

**Assert helpers are never type predicates — narrow with a real `if`.**
`assert.isTrue(guard(x))` leaves `x` at the full union for ANY guard: the
signature takes a `boolean`, not a type predicate. Verified under tsgo for
`Exit.isFailure`, and it applies equally to `Result.isSuccess`/`isFailure` on
the kit's `*Result` APIs (jsonc, yaml, toml, markdown, glob, semver).

**`assert.deepStrictEqual` vs literal-typed encodes.** Comparing an encoded
value carrying literal types (`type: "root"`) against an untyped plain-object
fixture fails to COMPILE — chai's `<T>(actual: T, expected: T)` unifies `T` from
the first argument. The pattern is an explicit type argument:
`assert.deepStrictEqual<unknown>(encoded, fixture)`.
