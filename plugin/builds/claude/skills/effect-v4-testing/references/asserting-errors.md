# Asserting on typed errors — defects, narrowing and assert helpers

Loaded from `effect-v4-testing`. The parts of failure-channel testing beyond
`Effect.flip` / `Effect.result` / `Effect.exit`: proving a defect is NOT
laundered into the typed channel, and the assert-helper typing traps.

## Asserting a defect: `Effect.exit`, with an explicit else

`Effect.flip` swaps only the *typed* channel, so a defect escapes it and the
test errors instead of asserting. Defects go through `Effect.exit`, **with an
explicit throw/fail on the non-failure branch**:

```ts
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";

const subject = Effect.die(new Error("the expected message"))

it.effect("the subject dies with the expected message", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(subject);
    if (Exit.isFailure(exit)) {
      assert.include(Cause.pretty(exit.cause), "the expected message");
    } else {
      assert.fail("expected a defect, but the effect succeeded");
    }
  }),
);
```

**A narrowing `if` with no `else` asserts nothing on the other path.** A bare
`if (Exit.isFailure(exit)) { …assert… }` passes silently on success, and the
shape recurs across a suite once it is in one test. It is its own
anti-pattern, not an Exit-specific one.

## Proving a defect is not laundered into the typed channel

Genuine defects must NOT be swallowed into the typed channel — that is
what a flip-based test cannot prove:

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
coarse verdict, `Cause.hasDies` / `Cause.hasFails` are the one-line spellings.

## Assert-helper typing traps

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
