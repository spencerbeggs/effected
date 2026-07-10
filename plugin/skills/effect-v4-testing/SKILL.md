---
name: effect-v4-testing
description: Use when writing tests for Effect v4 code with @effect/vitest — it.effect + Effect.gen as the default runner, asserting on typed errors via Effect.flip or Effect.result, providing test/mock layers with layer(...) for any service in R (owned or consumed; Path.layer + FileSystem.layerNoop need no platform package), property tests with it.effect.prop over a Schema, TestClock for time-dependent logic, and the mutate-the-edges discipline for proving a suite can fail. Covers the sharp edges (no it.scoped, it.prop throws on a Schema) that only surface at test time.
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
- **There is no `it.scoped`** in `@effect/vitest@4.0.0-beta.94` — the Tester
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

`layer(...)` applies to **any service in a test's `R` — owned or consumed**.
Its signature (`@effect/vitest` `dist/index.d.ts:155`) takes any
`Layer.Layer<R, E>`; nothing requires the package under test to declare the
service. A package that owns no services but *consumes* `Path.Path` or
`FileSystem.FileSystem` through its `R` channel is exactly the package that
needs suite-boundary layers — do not read "has services" as a gate. (This
skill previously did, and the walker migration plan was consequently written
with per-test `.pipe(Effect.provide(Path.layer))` on every test — the very
pattern the rule forbids.)

Provide services at the **suite boundary** with `layer(...)`, not with
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

**Testing a boundary-tier package that does real IO needs no platform
package.** `Path.layer` and `FileSystem.layerNoop(partial)` both come from
`effect` core (Path.ts:870; FileSystem.ts:1040 — and there is **no**
`FileSystem.layer` in core, only `layerNoop`), so a package like
`@effected/walker` tests filesystem behavior with zero `@effect/platform-node`
devDependency:

```ts
import { layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

layer(Path.layer)("path ops", (it) => {
  it.effect("Path is in R, no Effect.provide in the body", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.strictEqual(path.dirname("/a/b"), "/a");
    }));
});

layer(FileSystem.layerNoop({ exists: (p) => Effect.succeed(p === "/a/.rc") }))(
  "stubbed filesystem", (it) => { /* fs.exists consults the stub */ });
```

A suite-boundary layer cannot vary per test, so a suite with several filesystem
fixtures needs **one `layer(...)` block per distinct fixture** — that is the
house shape in `packages/walker/__test__/`. For service and layer design, see
`effect-v4-services-layers`.

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

**`it.effect` ALWAYS installs a virtual `TestClock`. This is not opt-in.** Any
`Effect.sleep` / `Effect.delay` / `Effect.timeout` in a test body will **never
advance on its own** — the test hangs until vitest's 5000ms timeout kills it,
with no message pointing at the clock. If a test hangs for exactly five seconds,
suspect wall-clock time before you suspect your code.

Either drive the clock with `TestClock.adjust`, or **restructure the test to
need no time at all**. For an interrupt, prefer a failing sibling over a timeout:

```ts
// Interrupts the first effect, clock-free. `Effect.never` is not clock-backed.
yield* Effect.exit(
  Effect.all([codec.stringify(value), Effect.fail("x")], { concurrency: 2 }),
)
```

Note what that `Effect.all` reports: the **sibling's `Fail`** on the aggregate
cause, not the interrupt (`hasFails` true, `hasInterrupts` false). Asserting
`Cause.hasInterrupts` on the outer exit would pass for the wrong reason. Assert
on the *observable consequence* instead — that the interrupted resource still
works afterward.

Drive virtual time so schedules, timeouts, and retries resolve deterministically
instead of waiting on the wall clock:

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

## Draining a `PubSub` under `it.effect`

Three sharp edges, all clock-adjacent:

- **`PubSub.takeAll` suspends on an empty subscription.** Its return type is
  `Effect<NonEmptyArray<A>>` — that *is* the proof. Under the virtual clock it
  hangs to the vitest timeout. Use `PubSub.takeUpTo(sub, n)`, which returns what
  is there.
- **`PubSub.subscribe` requires a `Scope`**, and there is no `it.scoped`. Pipe
  `Effect.scoped` **before** `Effect.provide`.
- **`Effect.fork` does not exist** — it is `forkChild` / `forkScoped` /
  `forkIn` / `forkDetach`. And `Stream.fromQueue` rejects a `Subscription`.

The clock-free drain: subscribe, run the operation, then `takeUpTo`.

```ts
it.effect("emits the events", () =>
  Effect.gen(function* () {
    const svc = yield* ConfigEvents;
    const sub = yield* PubSub.subscribe(svc.events);
    yield* runTheOperation;
    const events = yield* PubSub.takeUpTo(sub, Number.MAX_SAFE_INTEGER);
    assert.deepStrictEqual(events.map((e) => e.event._tag), ["Discovered", "Loaded"]);
  }).pipe(Effect.scoped, Effect.provide(layers)),
);
```

If the service resolves its dependency from the **caller's** context at call
time, that layer must be `Layer.mergeAll`'d into the test's context, not buried
under `Layer.provide` beneath the service's own layer.

## A test that cannot fail is worse than no test — mutate the edges

A green suite proves nothing about the properties no test can observe. Over
one migration (`@effected/walker`), **eight** distinct mutants each survived a
fully green suite — no short-circuit, dropped first match, last-instead-of-first
directory, wrong iteration order, dropped error absorption, dropped `stopAt`,
whole-chain probe instead of anchored root. Every one had the same shape: **the
tests exercised the middle of a range and never its edges.** Two of the eight
were real behavioral bugs waiting to be introduced, and two of the holes
predated the migration — 120 inherited tests passed unmodified while unable to
catch a regression in either property.

For any test walking an ordered collection, check:

- Does a winning case land on the **first** element? The **last**? A **middle**
  one? (An implementation that probes everything and picks the first hit passes
  every suite whose only order-observing test wins on the last candidate.)
- Is there a case with **more than one** of every dimension the code iterates —
  e.g. several directories × several candidates per directory? Interleaving
  bugs are invisible until both dimensions are plural.
- Is every **failure path** in a fixture actually exercised, or does every
  fixture succeed?
- Is the property pinned through the **public seam the consumer calls**, or
  only through the primitive it delegates to? A property proven on `firstMatch`
  says nothing about `findUpward` unless a test crosses that seam.
- For an option like `stopAt`, does any test place the target **beyond** it, so
  the option must actually do something to pass?

The discipline: before committing a test you believe pins a property, **break
the implementation in the way the property forbids** (with the editor — never
`git checkout`/`git stash`, other work lives in the tree), watch that exact
test go red, revert the mutation, and confirm `git status --porcelain` is
clean. Suite strength is not predictable by grepping `__test__/` — a mutation
in one module may be caught by tests that never name it, because a shared test
layer routes through it. Only the mutant tells you.

## House conventions

- Tests live in each package's `__test__/` directory (`*.test.ts`), never
  co-located in `src/`.
- Construct domain values via the schema's `X.make`, never `new`.
- **Assert with `assert.*` from `@effect/vitest`, never `expect`.** Every test
  file in this monorepo does. `expect(x).toEqual(y)` → `assert.deepStrictEqual`;
  `toBe` → `assert.strictEqual`; `toBeInstanceOf` → `assert.instanceOf`;
  `toBe(true)` → `assert.isTrue`; `toHaveLength` → `assert.lengthOf`.
- Keep the boundary honest: assert that the package's own error escapes
  (`error._tag === "JsoncParseError"`), and that the schema path surfaces a
  `SchemaError` — the two must not drift.
- **A test that cannot fail is worse than no test** — see the mutation section
  above. Two more historical cases beyond the walker eight: a
  prototype-pollution guard whose payload could never mutate the asserted
  object, and a `@ts-expect-error` in a file the tsconfig silently excluded.

> **Version note.** Every signature above was verified against
> `@effect/vitest@4.0.0-beta.94` on `effect@4.0.0-beta.94`. If the `effect`
> catalog bumps, re-verify the `layer` options bag and the
> `it.prop`-throws-on-Schema behavior first — those are the most likely to shift.
