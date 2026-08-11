---
name: effect-v4-testing
description: Use when writing tests for Effect v4 code with @effect/vitest — it.effect + Effect.gen as the default runner, asserting on typed errors via Effect.flip or Effect.result (and Exit + Cause for defects), providing test/mock layers with layer(...) for any service in R (owned or consumed; Path.layer + FileSystem.layerNoop need no platform package), fault-injecting one method of a real layer, property tests with it.effect.prop over a Schema, TestClock for time-dependent logic, converting a plain-Vitest repo, and the mutate-the-edges discipline for proving a suite can fail. Covers the sharp edges (no it.scoped, it.prop throws on a Schema, vi.mock must import vi from vitest) and the FALSE GREENS that only surface at test time — layer() memoizing while Effect.provide does not, TestConsole swallowing Effect.log* through the same ConsoleRef, a small real delay in src hanging the virtual clock, a `0 tests passed` run that exits 0, TestClock starting at the epoch so clock reads return 1970, an eagerly-recording layerNoop stub, and a narrowing `if` with no else branch. Also covers structural checks over source text (import walkers, export assertions, comment strippers), the two-latch rule for concurrency-leak tests, and the reporter fields — unhandledErrors, a stray process.exitCode — that make a green suite lie.
---

# Effect v4 testing with `@effect/vitest`

`@effect/vitest` re-exports Vitest, so it is the single entrypoint for test
APIs — with one exception (`vi.mock`, below). Effect programs run through
`it.effect`, never through a bare `it()` that calls `Effect.runSync`/
`runPromise`. Our house test files (`packages/jsonc/__test__/Jsonc.test.ts`,
`packages/yaml/__test__/Yaml.test.ts`) are the canonical shapes. (The
`effect/testing/*` modules — TestClock, TestConsole, TestSchema, FastCheck —
are indexed in `effect-v4-module-index`; this skill owns how to use them.)

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
peer warning at all, failing only at runtime on the first `it.effect` call with
a message naming neither `@effect/vitest` nor a version —
`Cannot find module '.../@effect/vitest/.../node_modules/effect/dist/Arbitrary.js'`,
which reads as a broken install. Confirm with `npm view @effect/vitest
dist-tags` before believing any resolution. **Inside this monorepo** the
dependency comes from `catalog:effect`, which already pins the matching beta.

**`vi.mock` is the one import that must NOT come from `@effect/vitest`.** Vitest
hoists it above all imports, so a `vi` bound through the re-export is not yet
initialized and the file dies at load with `Cannot access '__vi_import_1__'
before initialization` — naming neither `vi` nor `@effect/vitest`. Write
`import { vi } from "vitest"` in any file calling `vi.mock`; `vi.fn` /
`vi.spyOn` work fine through the re-export (measured across 24 files).

**A spy restored in `try`/`finally` inside `Effect.gen` LEAKS.** A failing
assertion leaves through the *error channel*, so the `finally` does not run the
way the shape suggests, and a `vi.spyOn` on a process global that outlives its
test poisons its neighbours — false reds first, false greens later. Acquire and
release spies with `Effect.acquireUseRelease` instead →
[references/false-greens.md](./references/false-greens.md).

## The default runner: `it.effect` + `Effect.gen`

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Jsonc } from "../src/index.js";

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
  `skip`/`skipIf`/`runIf`/`only`/`each`/`fails`/`prop` — **`it.effect.skipIf`
  and `it.effect.runIf` exist and are well-typed** (`packages/vitest/src/index.ts:56-59`);
  reach for them instead of hand-rolling a conditional `describe`.
- **`it.live`** (`Tester<Scope.Scope | R>`) opts into the real `Clock` and live
  runtime services. Use only when a test genuinely needs wall-clock behavior.
- **`it.effect` takes a Vitest timeout as its third argument** —
  `it.effect(name, self, timeout?: number | TestOptions)`. Any real-time elapsed
  assertion above Vitest's 5000ms default is dead code without it (see
  [references/false-greens.md](./references/false-greens.md)).
- **Never** `it("...", () => Effect.runPromise(program))`. Plain `it()` is fine
  only for genuinely non-Effect pure code (`Jsonc.stripComments`, `Yaml.equals`).
- **Never** `it("...", () => Effect.gen(...))` either — the inverse mistake, and
  the worse one. Returning an Effect without running it hands Vitest a
  non-promise it does nothing with: the test reports **green having evaluated
  zero assertions**. The two shapes are inverses and only the first one looks
  wrong:

  | shape | runs? | symptom |
  | --- | --- | --- |
  | `it(..., () => Effect.runPromise(p))` | yes | correct result, execution laundered |
  | `it(..., () => p)` | **no** | always green, no assertion ever evaluated |

  The fix in both directions is `it.effect`. This shipped in
  `@effected/schemastore` and was caught
  only in review — and the vacuous test was the one cited as proof to a
  downstream consumer who had reported the very finding it failed to pin. A
  false green does not merely miss a regression; it gets used as evidence. The
  shape is greppable, so it belongs in a structural check (see
  [references/structural-checks.md](./references/structural-checks.md)).
- **Never launder an Effect into a fixture with `Effect.runSync`.** If a test
  input comes from an Effect (a parse, a decode), the test *is* an `it.effect`
  and you `yield*` it; if you only need a domain value, build it with `X.make`.
- **`yield* import(...)` breaks** — it throws `(intermediate value) is not
  iterable`, naming neither the import nor the yield. A dynamic import inside
  `Effect.gen` is `yield* Effect.promise(() => import("./thing.js"))`; a bulk
  `await` → `yield*` rewrite produces the broken form mechanically.

## Asserting on typed errors

A test for the failure channel must not let the error escape as a defect.
**`Effect.flip`** — swaps channels so the typed error becomes the success value
— is our house pattern:

```ts
it.effect("fails with an aggregate JsoncParseError", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(Jsonc.parse("{ bad }"));
    assert.strictEqual(error._tag, "JsoncParseError");
    assert.isAbove(error.errors.length, 0);
  }),
);
```

**`Effect.result`** — never fails; returns a `Result` you narrow with
`Result.isSuccess`/`isFailure` (the v4 replacement for the removed `Either`).
Reach for it when one program must assert on *both* channels. **`Effect.exit`**
— the full `Exit` (defects and interrupts included) when you must inspect a
`Cause`. Signatures (verified): `flip: Effect<A,E,R> => Effect<E,A,R>`,
`result: … => Effect<Result<A,E>,never,R>`, `exit: … => Effect<Exit<A,E>,never,R>`.

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
separate times in one migration. It is its own anti-pattern, not an
Exit-specific one.

Its second half — **genuine defects must NOT be swallowed into the typed
channel** — is what a flip-based test cannot prove (working example:
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
implementation that wraps the defect in a typed error still passes. For the
coarse verdict, `Cause.hasDies` / `Cause.hasFails` are the one-line spellings
(verified at beta.97; `@effected/git`'s `available` test).

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

## Providing test / mock layers

`layer(...)` applies to **any service in a test's `R` — owned or consumed**. Its
signature takes any `Layer.Layer<R, E>`; nothing requires the package under test
to declare the service. A package that owns no services but *consumes*
`Path.Path` or `FileSystem.FileSystem` needs suite-boundary layers most.

```ts
import { layer } from "@effect/vitest";

describe("foo", () => {
  layer(Foo.layer)((it) => {
    it.effect("gets foo", () =>
      Effect.gen(function* () { assert.strictEqual(yield* Foo, "foo"); }));
  });
});
```

### `layer()` memoizes; plain `Effect.provide` does NOT. That asymmetry is the whole decision

The top-level `layer` builds its layer once per group through a `MemoMap`
(`packages/vitest/src/internal/internal.ts:239,241`), keeps the scope open for
the group, and closes it in `afterAll`. A per-test `.pipe(Effect.provide(L))`
carries no memo map and rebuilds per test.

**But that is per-TEST, not per-provide: NESTED provides memoize constituent
consts.** Within one running effect, `Effect.provide` memoizes layers by
reference — an inner `Effect.provide(Layer.mergeAll(SharedConst, Variant))`
under an outer provide that already built `SharedConst` serves the **outer**
build of it, even though the `mergeAll` composition is a fresh reference
(probed at beta.101: nested builds once and the inner read sees the outer
instance; two sequential sibling `runPromise` roots build twice). The bite: a
test helper that provides real layers, wrapping a test that inner-provides a
fault-injected or scripted variant feeding those same constituent consts,
silently exercises the REAL services — the swap never takes effect for
anything already built outside. The tell is a green test with the wrong
duration (a retry policy actually running, a scripted response never
consumed). Restructure so the variant is provided at the outermost level, or
compose the fault into the layer before anything builds it.

**So per-test provide is the SAFE default, and collapsing a suite onto a
suite-boundary `layer()` is the RISKY move** — not the neutral one. Read
build-once as "every stateful resource in that layer is cumulative across the
group": `TestClock.adjust` advances a clock the *next* test inherits, an
in-memory store keeps its rows and subscribers, a TTL that expired in test 3 is
still expired in test 4, and `TestConsole.logLines` keeps accumulating.

The pre-flight before collapsing, in order:

1. **In-memory or on-disk state?** On-disk is safe — filesystem `beforeEach`
   hooks still run. In-memory (a `Ref`, a cache, a counter, a `calls` recorder)
   is not: three tests asserting a stub call count once read **4, 5 and 6
   instead of 1**, green throughout.
2. **Is the layer constant?** Necessary, not sufficient.
3. **Is the service stateful, with that state's lifetime under test?** A shared
   instance then dissolves the boundary under test while staying green. Grep
   candidates: `refresh()`, cache, memoization, "second call returns cached".
4. **Is the layer genuinely stateless** (`Logger.layer([])`)? Then memoization
   is unobservable and collapsing is free.
5. **Does the test drive the clock?** A clock-driving test must NOT live inside
   a `layer()` block — the group shares one `TestClock`.

Worked failures → [references/migrating-a-repo.md](./references/migrating-a-repo.md).
Where state must vary per test, keep the per-test provide, or use **distinct
keys per test** and flush explicitly before asserting counts.

Other `layer(...)` mechanics (unchanged at beta.101):

- The block hands you an `it` scoped to `R` (a `MethodsNonLive<R>`), and
  **`MethodsNonLive` has no `.live`** — a wall-clock test that also needs the
  group's layer goes **outside** the block as a top-level `it.live(...)` with
  `.pipe(Effect.provide(TheLayer))`.
- Nest extra deps with `it.layer(BarLayer)("nested", (it) => { … })` — the
  nested form takes **`timeout` only** and reuses the parent's memo map.
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

**`layerNoop` fails every member you did not override with a typed `NotFound`**
(`FileSystem.ts:912`, `:961`), which a package reading `NotFound` as
domain-level "absent" treats as a legitimate answer — so the stub silently
supplies **empty fixtures** the moment the code switches which read method it
calls. Override every read the code could reach, and assert fixture *contents*
somewhere. Same tier: **`readFileString` strips a leading BOM**
(`FileSystem.ts:789` decodes through `TextDecoder`, default `ignoreBOM: false`)
→ [references/false-greens.md](./references/false-greens.md).

A suite-boundary layer cannot vary per test, so several filesystem fixtures need
**one `layer(...)` block per fixture** — the house shape in
`packages/walker/__test__/`.

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
loudly. Full scaffold and the three ways to get the spread wrong →
**[references/fault-injection.md](./references/fault-injection.md)**.

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
  `Schemas are not supported yet`** at runtime, in both the array and record
  forms (`packages/vitest/src/internal/internal.ts:179,195`). Hand-built
  arbitraries go to `it.prop`: `it.prop("addition commutes",
  [FastCheck.integer(), FastCheck.integer()], ([a, b]) => a + b === b + a)`,
  importing `FastCheck` from `effect/testing`.
- **The named-record form of `it.effect.prop` is FIXED at beta.101** —
  `internal.ts:151` now converts a Schema value, so both `[Schema]` and
  `{ n: Schema }` work. The array-form-only workaround for beta.94 is retired.
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

### Real async I/O in the effect under test desyncs the drain loop — use `it.live`

Driving the clock only works when everything the effect awaits is *scheduled on
that clock*. An effect that interleaves **real filesystem I/O** with sleeps —
`fs.open` → real await → retry `Effect.sleep` — races `TestClock.adjust`: the
sleep created *after* resuming from the real await is not yet registered when
`adjust`'s drain loop re-checks, so the test hangs or flakes depending on how
the real I/O lands (hit live in a two-latch concurrency test over real file
locks, savvy-web/systems 2026-08). This is not fixable by adjusting harder:
virtual time cannot know when un-clocked real work will complete. The escape
hatch is **`it.live` for exactly those tests** — real clock, real I/O, one
timeline — placed **outside** the `layer()` block per the `MethodsNonLive`
shape above. Keep the rest of the suite on `it.effect`; the hatch is per-test,
not per-file.

### …and it starts at the EPOCH, so clock *reads* return 1970

The quiet half: `it.effect` starts the `TestClock` at time zero, so anything
that *reads* the clock computes against **1970-01-01T00:00:00.000Z** (probed on
beta.94 — `DateTime.now` inside a bare `it.effect` is exactly the epoch). A CLI
resolved **zero** Node versions because against a 1970 "now" every release was
still unreleased; any TTL or "newer than N days" check inverts. Set the clock
with `TestClock.setTime(...)` whenever the code under test reads time.

### Driving it

```ts
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
  **`effect/testing`** subpath — `TestClock`, `TestConsole`, `FastCheck`,
  `TestSchema`, not `@effect/vitest`.
- **Do not manually provide `TestClock.layer()` under `it.effect`.** They
  compose — `Clock` is a `Context.Reference` (`Clock.ts:111`), `TestClock.layer()`
  merely sets it (`TestClock.ts:379`), and `adjust` drives whatever clock is
  ambient through `fiber.getRef(Clock.Clock)` (`TestClock.ts:412`). Nothing
  breaks, but drop the provide: a nested TestClock captures its `liveClock` at
  build time (`TestClock.ts:235`), so its "live" clock **is** the outer
  TestClock — `withLive` returns virtual time and the
  too-long-without-advancing warning fiber can never fire.
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
applied and unrestored → [references/false-greens.md](./references/false-greens.md).

## `it.effect` also intercepts CONSOLE output — including `Effect.log*`

`TestEnv` installs `TestConsole` alongside the clock, so a test spying on the
real `console.log` to capture Effect's output silently captures **nothing** —
and **auditing for `Console.*` call sites is insufficient**, because Effect's
default logger writes through the same ref (`Logger.ts:273`, `:310`, `:354` all
read `options.fiber.getRef(effect.ConsoleRef)`). One repo's audit cleared a
package by grepping `Console.*` and missed three live `Effect.logWarning`
sites. Only direct `console.*`, direct `process.stdout.write` / `stderr.write`,
and a **replaced** logger set (`Logger.layer([...])` without
`mergeWithExisting`) writing to one of those are immune.

It fails silently, and it produced two vacuous passes — "no output in quiet
mode" tests that pass unconditionally because the drained sink is always empty.
**A test whose only assertions are negative is the vacuous-pass shape**; a
positive sibling is the cheap proof the sink is live. `TestConsole.logLines` is
cumulative and never drained by reading it, so a test invoking a CLI twice
asserts against a growing buffer →
[references/false-greens.md](./references/false-greens.md).

## A test that cannot fail is worse than no test — mutate the edges

A green suite proves nothing about the properties no test can observe. Over one
migration (`@effected/walker`), **eight** distinct mutants each survived a fully
green suite; a later session turned up three more tests that were green,
plausible, and **structurally incapable of failing**.

The discipline: **capture a baseline** (`git status --porcelain > /tmp/baseline`),
break the implementation in the way the property forbids (with the editor —
never `git checkout`/`git stash`, other work lives in the tree), watch that
exact test go red, revert, and confirm the status matches the **baseline**, not
that it is empty.

- **The assertion must DISCRIMINATE** — confirm the test fails *for the right
  reason*, not merely that it fails.
- **Read the failure TEXT; never infer a catch from a missing pass line.** A
  mutant is verified only once you have seen the assertion message and it names
  the property you expected to break. Empty output means the tooling is
  suspect — a grep too narrow to match the failure, a filter that dropped it —
  not that the mutant died.
- **Never verify a change by grepping for the text you just wrote.** Grep finds
  the declaration; only a mutation finds the emit site.
- **A semantics-preserving perf fix cannot be pinned** — report it as
  fixed-but-unpinned rather than inventing a test that proves nothing.
- **A surviving mutant is a question about the CODE**, not only about the test.
  Ask whether the mutated behavior was ever required before writing an assertion
  that pins an accident; deleting the code is a legitimate answer.
- **Sweeping many mutants, assert the on-disk state every run** — one stale
  restore turns every later result into nonsense that looks like data. When two
  reads of one file disagree, settle it against the committed blob
  (`git show HEAD:<path>`), never by taking the read that suits the conclusion.

Full discipline, the checklist and the worked failures →
**[references/mutation-testing.md](./references/mutation-testing.md)**.

### Structural checks over source text

An invariant a type cannot express — "this module does not reach that
dependency", "the entrypoint exports this by name" — gets pinned by asserting
over source text, and those assertions fail silently where ordinary ones shout.
**Raw source is SAFE for a `notInclude` check (a comment mention is a spurious
alarm) and DANGEROUS for an `include` one (a comment mention passes).** Strip
comments — LINE comments **before** block comments — remove module specifiers,
match on a word boundary, and give the stripper its own discriminating test once
it is load-bearing → **[references/structural-checks.md](./references/structural-checks.md)**.

## Other false greens, in one place

`0 tests passed` is a FAILED run that exits 0 (three producers — one bad file
zeroing a whole package, and the `cd <pkg> && tsc && vitest --project` chain
that poisons only its vitest half while the typecheck half genuinely passes);
`TestConsole.logLines` accumulation; the eager `layerNoop` recorder;
`PubSub.takeAll` hanging on an empty subscription; timing gates lying by ~18×
under coverage; a green suite that fails the vitest **process** because a test
left `process.exitCode` set; a big green count for a surface the suite never
calls; a helper used on **both sides** of every comparison, which agrees with
itself however broken it is. Each with its probe →
**[references/false-greens.md](./references/false-greens.md)**.

**Zero collected tests is never a pass. Read the Tests line, not the exit
code — and read `unhandledErrors` with it:** a `ChildProcess` with no `error`
listener re-throws asynchronously *after* the failure was correctly reported,
and 15 green tests carried a live defect that only that field showed.

**The stale-upstream-dist red herring** (a red that lies rather than a green):
in a kit monorepo, a downstream package's tests resolve workspace siblings
through their BUILT dist (the lockfile links `version: link:../npm/dist/dev/pkg`),
so adding an export to an upstream package makes every downstream suite fail
to LOAD with `Cannot read properties of undefined (reading 'ast')` — the new
export exists in source, is `undefined` in the stale artifact, and the schema
built from it dies at module load pointing nowhere near the cause. When you
add an export to an upstream kit package, `pnpm build --filter <upstream>`
before running any downstream suite; that error message at suite load IS the
stale-dist signature.

## House conventions

- Tests live in each package's `__test__/` directory (`*.test.ts`), never
  co-located in `src/`.
- Construct domain values via the schema's `X.make`, never `new`.
- **In this monorepo, assert with `assert.*` from `@effect/vitest`, never
  `expect`** — the root `CLAUDE.md` mandates it and every test file here obeys.
  `toEqual` → `assert.deepStrictEqual`; `toBe` → `assert.strictEqual`;
  `toBeInstanceOf` → `assert.instanceOf`; `toBe(true)` → `assert.isTrue`;
  `toHaveLength` → `assert.lengthOf`. **This is house convention, not a
  technical constraint** — `expect` works unchanged inside `it.effect`, so in a
  repo whose house style is `expect`, do **not** sweep it. Follow the host repo.
- Keep the boundary honest: assert that the package's own error escapes
  (`error._tag === "JsoncParseError"`), and that the schema path surfaces a
  `SchemaError` — the two must not drift.
- **A test that cannot fail is worse than no test.** Two cases beyond the walker
  eight: a prototype-pollution guard whose payload could never mutate the
  asserted object, and a `@ts-expect-error` in a tsconfig-excluded file.

> **Version note.** Verified against `@effect/vitest@4.0.0-beta.101` on
> `effect@4.0.0-beta.101` (2026-07-25), with older probes dated inline. If the
> `effect` catalog bumps, re-verify the `layer` options bag and the
> `it.prop`-throws-on-Schema behavior first.
