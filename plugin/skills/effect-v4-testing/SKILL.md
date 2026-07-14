---
name: effect-v4-testing
description: Use when writing tests for Effect v4 code with @effect/vitest — it.effect + Effect.gen as the default runner, asserting on typed errors via Effect.flip or Effect.result, providing test/mock layers with layer(...) for any service in R (owned or consumed; Path.layer + FileSystem.layerNoop need no platform package), property tests with it.effect.prop over a Schema, TestClock for time-dependent logic, and the mutate-the-edges discipline for proving a suite can fail. Covers the sharp edges (no it.scoped, it.prop throws on a Schema) and the FALSE GREENS that only surface at test time — a `0 tests passed` run that exits 0, TestClock starting at the epoch so clock reads return 1970, TestConsole.logLines accumulating across invocations, an eagerly-recording layerNoop stub, and Exit.isFailure failing to narrow inside assert.isTrue.
---

# Effect v4 testing with `@effect/vitest`

`@effect/vitest` re-exports Vitest, so it is the single entrypoint for test
APIs. Effect programs run through `it.effect`, never through a bare `it()` that
calls `Effect.runSync`/`runPromise`. Our house test files
(`packages/jsonc/__test__/Jsonc.test.ts`, `packages/yaml/__test__/Yaml.test.ts`)
are the canonical shapes; this skill is why they look the way they do. (The
`effect/testing/*` modules — TestClock, TestConsole, TestSchema, FastCheck —
are indexed in `effect-v4-module-index`; this skill owns how to use them.)

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
- **`it.effect` takes a Vitest timeout as its third argument** —
  `it.effect(name, self, timeout?: number | TestOptions)` (`@effect/vitest`
  `dist/index.d.ts:33`). The trap: any real-time elapsed assertion above
  Vitest's default 5000ms is **dead code** without it — Vitest aborts the test
  before the assertion runs, and the failure reads "Test timed out in 5000ms",
  not your bound. A wall-clock ceiling and the test's timeout must be
  calibrated together; whichever is lower is the effective bound (the toml
  scale suite shipped a 30s `assert.isBelow` under the 5s default and CI
  red-flagged the *same* test twice before the timeout argument was added).
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

The invariant has a second half those two cannot prove: **genuine defects must
NOT be swallowed into the typed channel** (a catch-all that masks a programmer
error as a domain error passes every flip-based test). Asserting a Die takes
the exit apart (`Cause.isDieReason`/`isFailReason` and `.cause.reasons`
verified against beta.94 `Cause.d.ts`/`Exit.d.ts`; working example:
`packages/toml/__test__/hostile.test.ts` "defect passthrough"):

```ts
const exit = yield* Effect.exit(program);
// `assert.isTrue(Exit.isFailure(exit))` does NOT narrow `exit` — assert helpers
// are not type predicates, so `exit.cause` below would not compile under tsgo.
// Narrow with a real `if`, and fail explicitly on the other branch.
if (!Exit.isFailure(exit)) {
 assert.fail("expected a defect, got a success");
}
assert.isFalse(exit.cause.reasons.some(Cause.isFailReason)); // NOT a typed Fail
const die = exit.cause.reasons.find(Cause.isDieReason);
assert.instanceOf(die?.defect, Error);          // the ORIGINAL error, unmasked
assert.notInstanceOf(die?.defect, MyTypedError); // not laundered into E
```

When you only need the coarse verdict — "the cause carries a Die and no Fail" —
`Cause.hasDies(exit.cause)` / `Cause.hasFails(exit.cause)` are the one-line
spellings (both verified at beta.97; the `@effected/git` `available`
defect-passthrough test is the working example). Reach for the full
`reasons.find(Cause.isDieReason)` form above only when the assertion must also
inspect the ORIGINAL defect value.

The no-Fail-reason line is the discriminating assertion — without it, an
implementation that wraps the defect in a typed error still passes.

**`Exit.isFailure` inside `assert.isTrue(...)` does not narrow.** Verified under
tsgo: `assert.isTrue(Exit.isFailure(exit))` leaves `exit` at the full union, so
the next line's `exit.cause` is a type error. Use `if (Exit.isFailure(exit)) { … }`
as above, or go through `Exit.getCause(exit)` → `Option<Cause<E>>` and branch on
`Option.isSome`.

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
- **`MethodsNonLive` has no `.live`** — `it.live` does not exist inside a
  `layer(...)` block (verified against the beta.97 vitest source: `layer`'s
  callback is typed `MethodsNonLive<R>`; only the top-level `Methods` adds
  `live`). A wall-clock test that also needs the group's layer goes **outside**
  the block as a top-level `it.live(...)` with the layer provided directly via
  `.pipe(Effect.provide(TheLayer))`. Discovered live when a real-sleep
  interruption test could not be written inside the group.
- Nest extra deps with `it.layer(BarLayer)("nested", (it) => { … })`. The nested
  form takes **`timeout` only** (no `memoMap`, no `excludeTestServices`) and
  reuses the parent's memo map.
- **A mock service is a `Context.Service` with a test `Layer`**
  (an in-memory or stub implementation) provided via `layer(...)` — swap
  `Live` → `Test` at this boundary, not inside test bodies.
- `layer(L, { excludeTestServices: true })` runs the group **without** the
  `TestClock`/`TestConsole` overrides (keep live behavior for that group).
- **Build-once means shared-state-across-tests — the whole group, not just
  `TestConsole`.** Because the layer is built once per group, every stateful
  resource in it is cumulative across the group's tests: `TestClock.adjust`
  advances a clock the *next* test inherits, an in-memory store (`:memory:`
  SQLite, a `Ref`, a `PubSub`) keeps its rows and subscribers, and a TTL that
  expired in test 3 is still expired in test 4. The `TestConsole.logLines`
  accumulation this skill already lists is one instance of this rule, not the
  rule. Write group tests against **distinct keys/specs per test**, or flush
  explicitly before asserting counts (the ts-vfs `TypeCache` suite pre-flushes
  its prune test for exactly this reason — it was bitten first).

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
- **Schemas go in the ARRAY form only — the named-record form is broken in
  beta.94.** `it.effect.prop("…", { n: Schema.Number }, ({ n }) => …)`
  type-accepts a Schema but dies at collection with fast-check's
  `Invalid parameter encountered at index 0: expecting an Arbitrary`: the
  internals convert the Schema via `toArbitrary` and then unconditionally
  overwrite the converted value with the raw Schema
  (`@effect/vitest@4.0.0-beta.94` `dist/internal/internal.js:92-98`), so
  `fc.record` receives the Schema itself. The error never names Schema, so it
  reads like a caller mistake — it is not. Raw `FastCheck` arbitraries still
  work in record form; Schemas require the array form (`[Schema.Number]`,
  destructure positionally). Surfaced by the `@effected/glob` port; re-probe
  on each catalog bump in case the upstream fix lands.
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

### …and it starts at the EPOCH, so clock *reads* return 1970

The hang is the loud half. The quiet half: **`it.effect` starts the `TestClock`
at time zero**, so anything that *reads* the clock computes against
**1970-01-01T00:00:00.000Z**. Probed on beta.94 — `DateTime.now` inside a bare
`it.effect` is exactly the epoch.

Nothing hangs. Nothing errors. The code just answers as if it were 1970:

- a CLI resolved **zero** Node versions, because against a 1970 "now" every
  release was still *unreleased*;
- any "is this newer than N days" / TTL / cache-expiry check inverts;
- a freshness filter silently keeps everything, or drops everything.

If a time-dependent test passes but the *value* looks absurd — an empty result
set, or nothing ever expiring — suspect the epoch before you suspect your logic.
Set the clock explicitly (`TestClock.setTime(...)`) whenever the code under test
*reads* time rather than merely sleeping.

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

## `TestConsole.logLines` ACCUMULATES for the whole test

`TestConsole.logLines` is cumulative and is **never drained by reading it**.
Probed on beta.94: two reads across one test returned 2 lines then 4 lines, and
the second read still contained the first run's output.

That makes this a false green:

```ts
// BOTH assertions read the FIRST run's output. The second cannot fail.
yield* runCli(["--target", "a"]);
assert.include(JSON.stringify(yield* TestConsole.logLines), "a");
yield* runCli(["--target", "b"]);
assert.include(JSON.stringify(yield* TestConsole.logLines), "a"); // still passes!
```

Any test that invokes a CLI (or any logging subject) **twice** is asserting
against a growing buffer. Either put each invocation in its **own `it.effect`**,
or snapshot the length before the second call and assert only on the new tail.

## A `layerNoop` stub records at effect CONSTRUCTION time

A recorder that pushes eagerly logs calls **that never executed**:

```ts
// WRONG — pushes when the effect is BUILT, not when it runs.
FileSystem.layerNoop({
 readFileString: (p) => { calls.push(p); return Effect.succeed(""); },
});

// RIGHT — the push happens only if the effect actually runs.
FileSystem.layerNoop({
 readFileString: (p) => Effect.suspend(() => { calls.push(p); return Effect.succeed(""); }),
});
```

Probed on beta.94: a service that builds its effects once (at layer construction,
or anywhere the effect is constructed but not yielded) made the eager recorder
log `/never-executed` for a read that never happened; the `Effect.suspend` version
recorded nothing. **Wrap every recorder in `Effect.suspend`** — otherwise a test
asserting "the file was read" passes against a code path that was only *described*,
never run.

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

A green suite proves nothing about the properties no test can observe. Over one
migration (`@effected/walker`), **eight** distinct mutants each survived a fully
green suite. In a later session, mutation turned up three more tests that were
green, plausible, and **structurally incapable of failing**.

The discipline: **capture a baseline** (`git status --porcelain > /tmp/baseline`),
then break the implementation in the way the property forbids (with the editor —
never `git checkout`/`git stash`, other work lives in the tree), watch that exact
test go red, revert, and confirm the status matches the **baseline** — not that it
is empty. Unrelated uncommitted work is normal; the check is that you left the
tree exactly as you found it.

Run the mutant to **find out**, not to watch it go red. Three rules carry most of
the value:

- **The assertion must DISCRIMINATE** — confirm the test fails *for the right
  reason*, not merely that it fails.
- **Never verify a change by grepping for the text you just wrote.** Grep finds
  the declaration; only a mutation finds the emit site.
- **A semantics-preserving perf fix cannot be pinned** — report it as
  fixed-but-unpinned rather than inventing a test that proves nothing.

Full discipline, the edge-case checklist, and the worked failures →
**[references/mutation-testing.md](./references/mutation-testing.md)**.

## `0 tests passed` is a FAILED run, not an empty one

A module-level throw — most commonly the `Context.Service` TDZ (see
`effect-v4-services-layers`) — is swallowed by the agent reporter, which prints
`0 tests passed` and **exits 0**. It typechecks clean, so nothing else warns you.

**Zero collected tests is never a pass.** Read the Tests line, not the exit code.
If a file you just touched reports no tests, it did not run: import it directly
and look at the throw before you believe anything else the suite says.

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
