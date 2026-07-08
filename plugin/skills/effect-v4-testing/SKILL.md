---
name: effect-v4-testing
description: Use when writing tests for Effect v4 code with @effect/vitest — it.effect + Effect.gen as the default runner, asserting on typed errors via Effect.flip or Effect.result, providing test/mock layers with layer(...), property tests with it.effect.prop over a Schema, and TestClock for time-dependent logic. Covers the sharp edges (no it.scoped, it.prop throws on a Schema) that only surface at test time.
---

# Effect v4 testing with `@effect/vitest`

`@effect/vitest` re-exports Vitest, so it is the single entrypoint for test
APIs. Effect programs run through `it.effect`, never through a bare `it()` that
calls `Effect.runSync`/`runPromise`. Our house test files
(`packages/jsonc/__test__/Jsonc.test.ts`, `packages/yaml/__test__/Yaml.test.ts`)
are the canonical shapes; this skill is why they look the way they do.

## The default runner: `it.effect` + `Effect.gen`

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Jsonc, JsoncParseError } from "../src/index.js";

describe("Jsonc", () => {
  it.effect("parses objects, arrays and scalars", () =>
    Effect.gen(function* () {
      const value = yield* Jsonc.parse('{ "a": 1 }');
      assert.deepStrictEqual(value, { a: 1 });
    }),
  );
});
```

- **`it.effect` runs the returned Effect** and provides the default test
  environment (`TestClock` + `TestConsole`). Its type is
  `Tester<R | Scope.Scope>` — it already carries a `Scope`, so scoped effects
  (`Effect.acquireRelease`, scoped layers) run **directly** under `it.effect`.
- **There is no `it.scoped`** in `@effect/vitest@4.0.0-beta.93` — the Tester
  surface is `skip`/`skipIf`/`runIf`/`only`/`each`/`fails`/`prop`. Do not reach
  for it; scoped resources need no separate tester.
- **`it.live`** (`Tester<Scope.Scope | R>`) opts into the real `Clock` and live
  runtime services with no test-env overrides. Use only when a test genuinely
  needs wall-clock behavior; the default stays `it.effect`.
- **Never** `it("...", () => Effect.runPromise(program))`. Plain `it()` is fine
  only for genuinely non-Effect pure code (`Jsonc.stripComments`, `Yaml.equals`)
  — anything that yields an Effect uses `it.effect`.
- **Never launder an Effect into a fixture with `Effect.runSync`.** If a test
  input comes from an Effect (a parse, a decode), the test *is* an `it.effect`
  and you `yield*` it. If you only need a domain value to assert other behavior,
  build it with `X.make` from structured fields. A pure `it()` whose input is
  `Effect.runSync(X.parse(input))` is the same smell as `runPromise` in the
  body — it hides an execution the runner rule exists to surface. Both roads
  lead away from `runSync`.
- **Assert with `assert.*`**, not `expect`, inside Effect programs — it reads
  uniformly in generator bodies. House usage: `assert.deepStrictEqual`,
  `assert.strictEqual`, `assert.isTrue`, `assert.instanceOf`, `assert.include`,
  `assert.isAbove`.

## Asserting on typed errors

A test for the failure channel must not let the error escape as a defect. Two
verified patterns:

**`Effect.flip`** — swaps channels so the typed error becomes the success value.
This is our house pattern:

```ts
it.effect("fails with an aggregate JsoncParseError", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(Jsonc.parse("{ bad }"));
    assert.instanceOf(error, JsoncParseError);
    assert.strictEqual(error._tag, "JsoncParseError");
    assert.isAbove(error.errors.length, 0);
  }),
);
```

**`Effect.result`** — never fails; returns a `Result` you narrow with
`Result.isSuccess`/`Result.isFailure` (the v4 replacement for the removed
`Either`). Reach for it when one program must assert on *both* channels, or to
prove an input does not throw at all:

```ts
const result = yield* Effect.result(Yaml.parse(doc));
assert.isTrue(result._tag === "Success", `${doc} should parse`);
```

**`Effect.exit`** — the full `Exit` (including defects and interrupts) when you
must inspect a `Cause`. Signatures (verified): `Effect.flip: Effect<A,E,R> =>
Effect<E,A,R>`, `Effect.result: Effect<A,E,R> => Effect<Result<A,E>,never,R>`,
`Effect.exit: Effect<A,E,R> => Effect<Exit<A,E>,never,R>`.

This is the same invariant the parser-hardening skill enforces: malformed input
fails through the typed channel, never as an unhandled defect. `Effect.flip`
and `Effect.result` are how you *prove* it in a test.

## Providing test / mock layers

When a package has services (a `Context.Service` with a static
`layer`), provide them at the **suite boundary** with `layer(...)`, not with
per-test `.pipe(Effect.provide(L))`. The top-level `layer` builds the layer once
per group, memoizes it via a `MemoMap`, keeps the scope open for the group, and
closes it in `afterAll`:

```ts
import { layer } from "@effect/vitest";

class Foo extends Context.Service<Foo, string>()("Foo") {
  static readonly layer = Layer.succeed(Foo)("foo");
}

describe("foo", () => {
  layer(Foo.layer)((it) => {
    it.effect("gets foo", () => Effect.gen(function* () {
      assert.strictEqual(yield* Foo, "foo");
    }));
  });
});
```

- The `layer` block hands you an `it` scoped to `R` (a `MethodsNonLive<R>`); use
  its `it.effect` normally — the service is already in the environment.
- Nest extra deps with `it.layer(BarLayer)("nested", (it) => { … })`. The nested
  form takes **`timeout` only** (no `memoMap`, no `excludeTestServices`) and
  reuses the parent's memo map.
- **A mock service is a `Context.Service` with a test `Layer`**
  (an in-memory or stub implementation) provided via `layer(...)` — swap
  `Live` → `Test` at this boundary, not inside test bodies.
- `layer(L, { excludeTestServices: true })` runs the group **without** the
  `TestClock`/`TestConsole` overrides (keep live behavior for that group).

The pure-tier packages (semver, jsonc, yaml) have no services yet, so no house
file exercises `layer(...)` — adopt it when a service-tier package lands. For
service and layer design, see `effect-v4-services-layers`.

## Property testing with `it.effect.prop`

Feed a Schema (or class — the class *is* the schema) directly as an arbitrary;
`it.effect.prop` converts it via `Schema.toArbitrary`. This is our house
property-test tool:

```ts
const Sample = Schema.Struct({
  name: Schema.String,
  count: Schema.Int,
  enabled: Schema.Boolean,
  tags: Schema.Array(Schema.String),
});

it.effect.prop("parse recovers what stringify produced", [Sample], ([value]) =>
  Effect.gen(function* () {
    const text = yield* Yaml.stringify(value);
    assert.deepStrictEqual(yield* Yaml.parse(text), value);
  }),
);
```

- **Schema conversion is `it.effect.prop`-only.** The top-level `it.prop`
  (non-Effect body) accepts a `Schema` *in its type* but **throws at runtime** on
  a Schema input — it only takes explicit `FastCheck` arbitraries. If a property
  needs a hand-built arbitrary, import `FastCheck` from `effect/testing` and pass
  it to the top-level `it.prop`:

  ```ts
  import { FastCheck } from "effect/testing";

  it.prop("addition commutes", [FastCheck.integer(), FastCheck.integer()],
    ([a, b]) => a + b === b + a);
  ```

  Feed a Schema instead and you must use `it.effect.prop`.
- Run config (`numRuns`, `seed`, …) goes in the options bag as
  `{ fastCheck: { numRuns: 1000 } }` alongside `timeout`.
- **`isPattern` regexes must be lookahead-free.** `Schema.toArbitrary` derives
  generators from `.check(...)` constraints, and fast-check's `stringMatching`
  throws `Assertions of kind Lookahead not implemented yet`. Rewrite
  `/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` as `/^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/`. See
  `effect-v4-schema` for making field models canonical so round-trip
  properties do not lie.

## Time-dependent logic: `TestClock`

`TestClock` is provided by default under `it.effect`. Drive virtual time so
schedules, timeouts, and retries resolve deterministically instead of waiting on
the wall clock:

```ts
import { TestClock } from "effect/testing";
import { Effect, Fiber } from "effect";

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
  absolute time. Both return `Effect<void>`.
- Time helpers live under the **`effect/testing`** subpath in v4 — import
  `TestClock`, `TestConsole`, `FastCheck` from there, not from `@effect/vitest`
  or a standalone `@effect/*` package. (`effect/testing` exports exactly
  `FastCheck`, `TestClock`, `TestConsole`, `TestSchema`.)
- No time-dependent package exists in the repo yet — this is the shape to use
  when one lands; verify the exact signatures against the installed beta when
  you first reach for it.

## House conventions

- Tests live in each package's `__test__/` directory (`*.test.ts`), never
  co-located in `src/`.
- Construct domain values via the schema's `X.make`, never `new`.
- Use `assert.*` for explicit checks inside Effect programs.
- Keep the boundary honest: assert that the package's own error escapes
  (`error._tag === "JsoncParseError"`), and that the schema path surfaces a
  `SchemaError` — the two must not drift.

> **Version note.** Every signature above was verified against
> `@effect/vitest@4.0.0-beta.93` on `effect@4.0.0-beta.93`. If the `effect`
> catalog bumps, re-verify the `layer` options bag and the
> `it.prop`-throws-on-Schema behavior first — those are the most likely to shift.
