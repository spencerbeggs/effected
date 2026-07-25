---
name: effect-v4-testing
description: Use when writing tests for Effect v4 code with @effect/vitest — it.effect + Effect.gen as the default runner, asserting on typed errors via Effect.flip or Effect.result (and Exit + Cause for defects), providing test/mock layers with layer(...) for any service in R (owned or consumed; Path.layer + FileSystem.layerNoop need no platform package), fault-injecting one method of a real layer, property tests with it.effect.prop over a Schema, TestClock for time-dependent logic, converting a plain-Vitest repo, and the mutate-the-edges discipline for proving a suite can fail. Covers the sharp edges (no it.scoped, it.prop throws on a Schema, vi.mock must import vi from vitest) and the FALSE GREENS that only surface at test time — layer() memoizing while Effect.provide does not, TestConsole swallowing Effect.log* through the same ConsoleRef, a small real delay in src hanging the virtual clock, a `0 tests passed` run that exits 0, TestClock starting at the epoch so clock reads return 1970, an eagerly-recording layerNoop stub, and a narrowing `if` with no else branch.
---

# Effect v4 testing with `@effect/vitest`

`@effect/vitest` re-exports Vitest, so it is the single entrypoint for test
APIs — with one exception (`vi.mock`, below). Effect programs run through
`it.effect`, never through a bare `it()` that calls `Effect.runSync`/
`runPromise`. Our house test files (`packages/jsonc/__test__/Jsonc.test.ts`,
`packages/yaml/__test__/Yaml.test.ts`) are the canonical shapes; this skill is
why they look the way they do. (The `effect/testing/*` modules — TestClock,
TestConsole, TestSchema, FastCheck — are indexed in `effect-v4-module-index`;
this skill owns how to use them.)

**Migrating a plain-Vitest Effect repo? Adopt `@effect/vitest`.** A repo whose
tests are plain Vitest is not "nothing to migrate on the testing axis": add
`@effect/vitest` and route Effect-returning tests through `it.effect`. The
conversion has its own traps →
**[references/migrating-a-repo.md](./references/migrating-a-repo.md)**.

**Install it by exact version, matching your `effect` pin** — never bare, never
`@beta`. The v4 line is published only under prerelease versions mirroring
`effect`'s own beta numbering; neither default resolves to it (checked
2026-07-24):

| Specifier | Resolves to | Peers on |
| --- | --- | --- |
| bare / `@latest` | `0.30.0` | `effect@^3.22.0` — **the v3 line** |
| `@beta` | `4.0.0-beta.101` | `effect@^4.0.0-beta.101` — ahead of a beta.99 pin |
| `@4.0.0-beta.101` | `4.0.0-beta.101` | `effect@^4.0.0-beta.101` ✅ |

The bare form is the dangerous one: it installs the **v3-line** package with no
peer warning at all, and fails only at runtime on the first `it.effect` call,
with a message that never mentions `@effect/vitest`, v3-vs-v4, or versions —
`Cannot find module '.../@effect/vitest/.../node_modules/effect/dist/Arbitrary.js'`.
That reads as a broken install, not a version-line mismatch. Confirm with
`npm view @effect/vitest dist-tags` before believing any resolution. **Inside
this monorepo** the dependency comes from `catalog:effect`, which already pins
the matching beta.

**`vi.mock` is the one import that must NOT come from `@effect/vitest`.** Vitest
hoists `vi.mock(...)` above all imports, so a `vi` bound through the re-export
is not yet initialized and the file dies at load with `Cannot access
'__vi_import_1__' before initialization` — a message naming neither `vi` nor
`@effect/vitest`. Write `import { vi } from "vitest"` in any file calling
`vi.mock`. `vi.fn` / `vi.spyOn` are ordinary runtime calls and work fine through
the re-export (measured across 24 files); importing `vi` from `"vitest"`
uniformly is cheap insurance, not a requirement.

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
  environment — `TestEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())`
  (`packages/vitest/src/internal/internal.ts:42`). Its type is
  `Tester<R | Scope.Scope>`, so scoped effects (`Effect.acquireRelease`, scoped
  layers) run **directly** under `it.effect`.
- **There is no `it.scoped`** (still true at beta.101). The Tester surface is
  `skip`/`skipIf`/`runIf`/`only`/`each`/`fails`/`prop`
  (`packages/vitest/src/index.ts:56-59` for the two conditional forms) —
  **`it.effect.skipIf(cond)` and `it.effect.runIf(cond)` exist and are
  well-typed**; reach for them instead of hand-rolling a conditional `describe`.
- **`it.live`** (`Tester<Scope.Scope | R>`) opts into the real `Clock` and live
  runtime services. Use only when a test genuinely needs wall-clock behavior.
- **`it.effect` takes a Vitest timeout as its third argument** —
  `it.effect(name, self, timeout?: number | TestOptions)`. Any real-time elapsed
  assertion above Vitest's 5000ms default is dead code without it (see
  [references/false-greens.md](./references/false-greens.md)).
- **Never** `it("...", () => Effect.runPromise(program))`. Plain `it()` is fine
  only for genuinely non-Effect pure code (`Jsonc.stripComments`, `Yaml.equals`).
- **Never launder an Effect into a fixture with `Effect.runSync`.** If a test
  input comes from an Effect (a parse, a decode), the test *is* an `it.effect`
  and you `yield*` it. If you only need a domain value to assert other behavior,
  build it with `X.make` from structured fields.
- **`yield* import(...)` breaks** — it throws `(intermediate value) is not
  iterable`, naming neither the import nor the yield. A dynamic import inside
  `Effect.gen` is `yield* Effect.promise(() => import("./thing.js"))`. A bulk
  `await` → `yield*` rewrite produces the broken form mechanically.

## Asserting on typed errors

A test for the failure channel must not let the error escape as a defect.

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
prove an input does not throw at all.

**`Effect.exit`** — the full `Exit` (defects and interrupts included) when you
must inspect a `Cause`. Signatures (verified): `Effect.flip: Effect<A,E,R> =>
Effect<E,A,R>`, `Effect.result: Effect<A,E,R> => Effect<Result<A,E>,never,R>`,
`Effect.exit: Effect<A,E,R> => Effect<Exit<A,E>,never,R>`.

**`Effect.flip` is WRONG for a defect.** It swaps only the *typed* channel, so a
defect escapes it and the test errors instead of asserting. Defects go through
`Effect.exit`, **with an explicit throw/fail on the non-failure branch**:

```ts
const exit = yield* Effect.exit(subject);
if (Exit.isFailure(exit)) {
  assert.include(Cause.pretty(exit.cause), "the expected message");
} else {
  assert.fail("expected a defect, but the effect succeeded");
}
```

**A narrowing `if` with no `else` asserts nothing on the other path.** A bare
`if (Exit.isFailure(exit)) { …assert… }` passes silently on success — found six
separate times in one migration. Treat it as its own anti-pattern, not an
Exit-specific one.

This is the same invariant the parser-hardening skill enforces: malformed input
fails through the typed channel, never as an unhandled defect. Its second half —
**genuine defects must NOT be swallowed into the typed channel** — is what a
flip-based test cannot prove (working example:
`packages/toml/__test__/hostile.test.ts` "defect passthrough"):

```ts
const exit = yield* Effect.exit(program);
if (!Exit.isFailure(exit)) {
  assert.fail("expected a defect, got a success");
}
assert.isFalse(exit.cause.reasons.some(Cause.isFailReason)); // NOT a typed Fail
const die = exit.cause.reasons.find(Cause.isDieReason);
assert.instanceOf(die?.defect, Error);          // the ORIGINAL error, unmasked
assert.notInstanceOf(die?.defect, MyTypedError); // not laundered into E
```

The no-Fail-reason line is the discriminating assertion — without it, an
implementation that wraps the defect in a typed error still passes. When you
only need the coarse verdict, `Cause.hasDies(exit.cause)` /
`Cause.hasFails(exit.cause)` are the one-line spellings (verified at beta.97;
the `@effected/git` `available` test is the working example).

**Assert helpers are never type predicates — narrow with a real `if`.** The rule
is general: `assert.isTrue(guard(x))` leaves `x` at the full union for ANY
guard, because the signature takes a `boolean`, not a type predicate. Verified
under tsgo for `Exit.isFailure`; the same trap applies to `Result.isSuccess`/
`Result.isFailure` on the kit's pure Result-returning APIs — `parseResult`/
`stringifyResult` across jsonc, yaml, toml and markdown, `compileResult` in
glob, `parseResult`/`intersectResult` in semver.

**`assert.deepStrictEqual` vs literal-typed encodes.** Comparing an encoded
value carrying literal types (`type: "root"`) against an untyped plain-object
fixture fails to COMPILE — chai's `<T>(actual: T, expected: T)` unifies `T` from
the first argument. Every encode round-trip against plain fixtures hits this;
the pattern is an explicit type argument, `assert.deepStrictEqual<unknown>(encoded, fixture)`.

## Providing test / mock layers

`layer(...)` applies to **any service in a test's `R` — owned or consumed**. Its
signature takes any `Layer.Layer<R, E>`; nothing requires the package under test
to declare the service. A package that owns no services but *consumes*
`Path.Path` or `FileSystem.FileSystem` through `R` is exactly the package that
needs suite-boundary layers.

```ts
import { layer } from "@effect/vitest";

describe("foo", () => {
  layer(Foo.layer)((it) => {
    it.effect("gets foo", () => Effect.gen(function* () {
      assert.strictEqual(yield* Foo, "foo");
    }));
  });
});
```

### `layer()` memoizes; plain `Effect.provide` does NOT. That asymmetry is the whole decision

The top-level `layer` builds its layer once per group through a `MemoMap`
(`packages/vitest/src/internal/internal.ts:239,241`), keeps the scope open for
the group, and closes it in `afterAll`. A per-test `.pipe(Effect.provide(L))`
carries no memo map and rebuilds per test.

**So per-test provide is the SAFE default, and collapsing a suite onto a
suite-boundary `layer()` is the RISKY move** — not the neutral or obviously
better one. Read the build-once rule as "every stateful resource in that layer
is cumulative across the group": `TestClock.adjust` advances a clock the *next*
test inherits, an in-memory store (`:memory:` SQLite, a `Ref`, a `PubSub`) keeps
its rows and subscribers, a TTL that expired in test 3 is still expired in test
4, and `TestConsole.logLines` keeps accumulating.

The pre-flight before collapsing, in order:

1. **Is the layer's state in-memory or on-disk?** On-disk is safe — filesystem
   `beforeEach` hooks still run. In-memory (a `Ref`, a cache, a counter, a
   `calls` recorder) is not: three tests asserting a stub call count once read
   **4, 5 and 6 instead of 1**, green throughout.
2. **Is the layer constant?** Necessary, not sufficient.
3. **Is the service stateful, with that state's lifetime under test?** If so, a
   shared instance dissolves the boundary under test while staying green — a
   never-self-expiring per-root cache made two "second read is cached" tests
   assert nothing. Grep candidates: `refresh()`, cache, memoization, "second
   call returns cached".
4. **Is the layer genuinely stateless** (`Logger.layer([])`)? Then memoization
   is unobservable and collapsing is free.
5. **Does the test drive the clock?** A clock-driving test must NOT live inside
   a `layer()` block — the group shares one `TestClock` and `adjust` is
   cumulative across its tests.

Worked failures → [references/migrating-a-repo.md](./references/migrating-a-repo.md).
Where you must vary state per test, keep the per-test provide, or write group
tests against **distinct keys/specs per test** and flush explicitly before
asserting counts.

Other `layer(...)` mechanics (unchanged at beta.101):

- The block hands you an `it` scoped to `R` (a `MethodsNonLive<R>`).
- **`MethodsNonLive` has no `.live`.** A wall-clock test that also needs the
  group's layer goes **outside** the block as a top-level `it.live(...)` with
  `.pipe(Effect.provide(TheLayer))`.
- Nest extra deps with `it.layer(BarLayer)("nested", (it) => { … })` — the
  nested form takes **`timeout` only** (no `memoMap`, no `excludeTestServices`)
  and reuses the parent's memo map.
- `layer(L, { excludeTestServices: true })` runs the group **without** the
  `TestClock`/`TestConsole` overrides.
- A mock service is a `Context.Service` with a test `Layer`, swapped
  `Live` → `Test` at this boundary, never inside test bodies.

**Testing a boundary-tier package that does real IO needs no platform package.**
`Path.layer` and `FileSystem.layerNoop(partial)` both come from `effect` core
(Path.ts:870; FileSystem.ts:1040 — there is **no** `FileSystem.layer` in core,
only `layerNoop`), so `@effected/walker` tests filesystem behavior with zero
`@effect/platform-node` devDependency:

```ts
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
fixtures needs **one `layer(...)` block per distinct fixture** — the house shape
in `packages/walker/__test__/`. For service and layer design, see
`effect-v4-services-layers`.

**Every stub effect goes through `Effect.suspend`.** A recorder that pushes
eagerly logs calls that never executed — `layerNoop({ readFileString: (p) => {
calls.push(p); … } })` records a read that was only *described*. Worked probe →
[references/false-greens.md](./references/false-greens.md).

### Faulting ONE method of a real layer

For "behaves like the real service except this one method fails on demand",
`layerNoop` is the wrong tool (it stubs everything) and there is no
`FileSystem.layerWith` / `Layer.mapService` at beta.101. The house recipe is
`Layer.effect` + spread the base + `Layer.provide(base)` — with
`Layer.updateService` (`Layer.ts:1999`) as the shorter form when the subject is
itself a layer, and `Layer.mock` (`Layer.ts:2262`) for partial stubs that die
loudly on an unimplemented method. Full scaffold and the three ways to get the
spread wrong → **[references/fault-injection.md](./references/fault-injection.md)**.

## Property testing with `it.effect.prop`

Feed a Schema (or class — the class *is* the schema) directly as an arbitrary;
`it.effect.prop` converts it via `Schema.toArbitrary`:

```ts
it.effect.prop("parse recovers what stringify produced", [Sample], ([value]) =>
  Effect.gen(function* () {
    const text = yield* Yaml.stringify(value);
    assert.deepStrictEqual(yield* Yaml.parse(text), value);
  }),
);
```

- **Schema conversion is `it.effect.prop`-only.** The top-level `it.prop`
  (non-Effect body) accepts a `Schema` in its *type* but **throws
  `Schemas are not supported yet`** at runtime — for both the array and record
  forms (`packages/vitest/src/internal/internal.ts:179,195`). That message is
  new at beta.101; older betas died with an opaque fast-check "expecting an
  Arbitrary" error instead. Hand-built arbitraries go to the top-level
  `it.prop`:

  ```ts
  import { FastCheck } from "effect/testing";

  it.prop("addition commutes", [FastCheck.integer(), FastCheck.integer()],
    ([a, b]) => a + b === b + a);
  ```

- **The named-record form of `it.effect.prop` is FIXED at beta.101.** It used to
  overwrite the converted arbitrary with the raw Schema; `internal.ts:151` now
  reads `result[key] = Schema.isSchema(arb) ? Schema.toArbitrary(arb) : arb`, so
  both `[Schema]` and `{ n: Schema }` convert correctly. The array-form-only
  workaround this skill carried for beta.94 is retired.
- **`isPattern` regexes must be lookahead-free.** `Schema.toArbitrary` derives
  generators from `.check(...)` constraints, and fast-check's `stringMatching`
  throws `Assertions of kind Lookahead not implemented yet`. Rewrite
  `/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` as `/^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/`.
- **`fc.fullUnicodeString` / `fc.fullUnicode` do not exist** in the FastCheck
  bundled with `effect/testing` (probed 2026-07-18). The v4 spelling for
  hostile-unicode strings is `FastCheck.string({ unit: "binary" })`; plain
  `FastCheck.string()` stays BMP-safe and misses exactly the inputs a
  never-throws property exists to find.

## Time-dependent logic: `TestClock`

**`it.effect` ALWAYS installs a virtual `TestClock`. This is not opt-in.**

### The hang: a small REAL delay anywhere under the test, usually in `src`

The expensive failure is not in the test file. It is a test with **no
`TestClock` reference at all**, quietly relying on a 1–10ms real delay, which
stops advancing the moment it runs under `it.effect` and hangs to the vitest
timeout with no message pointing at the clock. In one conversion every file that
already hand-wired `TestClock` converted cleanly; every genuine hang came from
files that never mention it — and **in three of four cases the sleep lived in
`src`, not the test**.

**Any `Effect.sleep`, retry schedule, timeout or polling interval anywhere under
the test — however small — needs either a driven clock or `it.live`.** Grep the
implementation, not only the test:

```text
Effect\.sleep|Effect\.timeout|Schedule\.|Effect\.retry|Effect\.repeat|baseDelay|intervalMs|setTimeout\(
```

If a test hangs for exactly five seconds, suspect wall-clock time before you
suspect your code.

### …and it starts at the EPOCH, so clock *reads* return 1970

The quiet half: `it.effect` starts the `TestClock` at time zero, so anything
that *reads* the clock computes against **1970-01-01T00:00:00.000Z** (probed on
beta.94 — `DateTime.now` inside a bare `it.effect` is exactly the epoch).
Nothing hangs, nothing errors: a CLI resolved **zero** Node versions because
against a 1970 "now" every release was still unreleased; any "newer than N days"
/ TTL / cache-expiry check inverts. If a time-dependent test passes but the
*value* looks absurd, suspect the epoch. Set the clock explicitly with
`TestClock.setTime(...)` whenever the code under test reads time.

### Driving it

```ts
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
  absolute time. Both return `Effect<void>`.
- Time helpers live under the **`effect/testing`** subpath — `TestClock`,
  `TestConsole`, `FastCheck`, `TestSchema`, not `@effect/vitest`.
- **Do not manually provide `TestClock.layer()` under `it.effect`.** They
  compose — `Clock` is a `Context.Reference` (`Clock.ts:111`) and
  `TestClock.layer()` merely sets it (`TestClock.ts:379`), so an inner provide
  shadows the runner's; `TestClock.adjust` is `Effect<void>` with `R = never`,
  resolving through `fiber.getRef(Clock.Clock)` (`TestClock.ts:412`), so it
  drives whatever clock is ambient. Nothing breaks, but drop the provide: a
  nested TestClock captures its `liveClock` at build time via `Clock.clockWith`
  (`TestClock.ts:235`), so under `it.effect` the inner clock's "live" clock **is
  the outer TestClock** — `withLive` returns virtual time and the
  too-long-without-advancing warning fiber can never fire.
- **Never call `TestClock.adjust` under `it.live`.** That `as TestClock` cast is
  unchecked — it is undefined behavior, not a type error.
- **A clock-driving test must not share a `layer()` group** — the group's clock
  is shared, so `adjust` is cumulative.

Or **restructure the test to need no time at all**. For an interrupt, prefer a
failing sibling over a timeout — `Effect.exit(Effect.all([subject,
Effect.fail("x")], { concurrency: 2 }))` interrupts the subject clock-free
(`Effect.never` is not clock-backed). Note what that reports: the **sibling's
`Fail`** on the aggregate cause, not the interrupt (`hasFails` true,
`hasInterrupts` false), so asserting `Cause.hasInterrupts` would pass for the
wrong reason. Assert on the *observable consequence* — that the interrupted
resource still works afterward.

## `it.effect` also intercepts CONSOLE output — including `Effect.log*`

`TestEnv` installs `TestConsole` alongside the clock, so a test spying on the
real `console.log` to capture Effect's output silently captures **nothing**.

The sharp edge: **auditing for `Console.*` call sites is insufficient.**
Effect's default logger writes through the same ref —
`options.fiber.getRef(effect.ConsoleRef)` at `packages/effect/src/Logger.ts:273`,
and again at `:310` and `:354` — so `Effect.log` / `logWarning` / `logError` are
intercepted identically. One repo's audit cleared a package by grepping
`Console.*` and missed three live `Effect.logWarning` sites.

Only three emit paths are genuinely immune: direct `console.*`, direct
`process.stdout.write` / `process.stderr.write`, and a **replaced** logger set
(`Logger.layer([...])` without `mergeWithExisting`) writing to one of those.

It fails silently, and it produced two vacuous passes — "expect no output in
quiet mode" tests that pass unconditionally because the sink `TestConsole`
drained is always empty. **A test whose only assertions are negative is the
vacuous-pass shape**; where a positive sibling exists, it is the cheap proof the
sink is live.

`TestConsole.logLines` is also cumulative and is never drained by reading it, so
any test that invokes a CLI twice asserts against a growing buffer →
[references/false-greens.md](./references/false-greens.md).

## A test that cannot fail is worse than no test — mutate the edges

A green suite proves nothing about the properties no test can observe. Over one
migration (`@effected/walker`), **eight** distinct mutants each survived a fully
green suite; a later session turned up three more tests that were green,
plausible, and **structurally incapable of failing**.

The discipline: **capture a baseline** (`git status --porcelain > /tmp/baseline`),
break the implementation in the way the property forbids (with the editor —
never `git checkout`/`git stash`, other work lives in the tree), watch that
exact test go red, revert, and confirm the status matches the **baseline** — not
that it is empty.

- **The assertion must DISCRIMINATE** — confirm the test fails *for the right
  reason*, not merely that it fails.
- **Never verify a change by grepping for the text you just wrote.** Grep finds
  the declaration; only a mutation finds the emit site.
- **A semantics-preserving perf fix cannot be pinned** — report it as
  fixed-but-unpinned rather than inventing a test that proves nothing.

Full discipline, the edge-case checklist, and the worked failures →
**[references/mutation-testing.md](./references/mutation-testing.md)**.

## Other false greens, in one place

`0 tests passed` is a FAILED run that exits 0 (three distinct producers,
including one bad file zeroing a whole package); `TestConsole.logLines`
accumulation; the eager `layerNoop` recorder; `PubSub.takeAll` hanging on an
empty subscription; timing gates lying by ~18× under coverage; a big green count
for a surface the suite never calls. Each with its probe →
**[references/false-greens.md](./references/false-greens.md)**.

**Zero collected tests is never a pass. Read the Tests line, not the exit code.**

## House conventions

- Tests live in each package's `__test__/` directory (`*.test.ts`), never
  co-located in `src/`.
- Construct domain values via the schema's `X.make`, never `new`.
- **In this monorepo, assert with `assert.*` from `@effect/vitest`, never
  `expect`** — the root `CLAUDE.md` mandates it and every test file here obeys.
  `expect(x).toEqual(y)` → `assert.deepStrictEqual`; `toBe` →
  `assert.strictEqual`; `toBeInstanceOf` → `assert.instanceOf`; `toBe(true)` →
  `assert.isTrue`; `toHaveLength` → `assert.lengthOf`.
  **This is house convention, not a technical constraint.** `@effect/vitest`
  re-exports Vitest and `expect` works unchanged inside `it.effect`; nothing
  about it is broken. In a repo whose house style is `expect`, do **not** sweep
  it — that triples a diff for zero behavior change. Follow the host repo.
- Keep the boundary honest: assert that the package's own error escapes
  (`error._tag === "JsoncParseError"`), and that the schema path surfaces a
  `SchemaError` — the two must not drift.
- **A test that cannot fail is worse than no test.** Two historical cases beyond
  the walker eight: a prototype-pollution guard whose payload could never mutate
  the asserted object, and a `@ts-expect-error` in a file the tsconfig silently
  excluded.

> **Version note.** Verified against `@effect/vitest@4.0.0-beta.101` on
> `effect@4.0.0-beta.101` (2026-07-25), with older probes dated inline. If the
> `effect` catalog bumps, re-verify the `layer` options bag and the
> `it.prop`-throws-on-Schema behavior first — those shift most often.
