---
name: effect-v4-testing
description: >-
  Use when writing, reviewing, or fixing tests for Effect v4 code. Covers @effect/vitest setup, it.effect and
  it.effect.prop usage, layer-based test/mock doubles for any service in R, fault-injecting one method of a real
  layer, TestClock/TestConsole/TestRandom semantics, the mutate-the-edges discipline for proving a suite can
  fail, and known false-green traps: 0/0 vitest runs that exit 0, epoch-based clock assertions, TestConsole
  swallowing Effect.log* through the same ConsoleRef, layer() memoizing while Effect.provide does not, and
  assertions that never execute. Also covers structural checks over source text (import walkers, export
  assertions) and converting a plain-Vitest repo to @effect/vitest.
---

# Effect v4 testing with `@effect/vitest`

`@effect/vitest` re-exports Vitest, so it is the single entrypoint for test
APIs — with one exception (`vi.mock`, below). Effect programs run through
`it.effect`, never through a bare `it()` that calls `Effect.runSync`/
`runPromise`. Our house test files (`packages/jsonc/__test__/Jsonc.test.ts`,
`packages/yaml/__test__/Yaml.test.ts`) are the canonical shapes. (The
`effect/testing/*` modules — TestClock, TestConsole, TestSchema — and the
property engine `effect/unstable/arbitrary` are indexed in
`effect-v4-module-index`; this skill owns how to use them. There is no
`FastCheck` module.)

**Migrating a plain-Vitest Effect repo? Adopt `@effect/vitest`.** A repo whose
tests are plain Vitest is not "nothing to migrate on the testing axis": add
`@effect/vitest` and route Effect-returning tests through `it.effect`. The
conversion has its own traps →
**[references/migrating-a-repo.md](./references/migrating-a-repo.md)**.

**Testing a specific front end or a repo-shape check routes elsewhere first.**
This skill owns the general `@effect/vitest` mechanics; a front end's own
testing subpath owns the rest: testing a CLI bin → `effect-v4-cli` (`CliTest`);
testing an MCP server → `effect-v4-mcp` (`McpHarness`, `McpProbe`); a
monorepo's own repo-shape checks (layering, source boundaries, packed
installs) → `@effected/workspaces/testing` (see `effected-packages`).

**Install it by exact version, matching your `effect` pin** — never bare,
never `@latest`, never `@beta`, never `@rc`. `@effect/vitest`'s v4 line is
published only under prerelease versions mirroring `effect`'s own numbering,
and no dist-tag can be trusted to resolve to your pin: a tag frozen on one
prerelease line goes stale the moment the v4 line moves past it, and a tag that
tracks the newest prerelease floats off your pin the instant upstream
publishes. Pin `@effect/vitest` to the *exact same* prerelease your `effect`
catalog pins, never a caret or a tag.

The bare/`@latest` form is the dangerous one: `latest` still points at the
**v3-line** package. pnpm installs it with only a one-line
`Issues with peer dependencies found` warning; `pnpm peers check` then lists
unmet `effect ^3` and `vitest ^3` peers from `@effect/vitest`. The runtime
failure names neither: the test file fails to load with
`Cannot find module '…/effect/dist/Arbitrary.js'`, because the v3 package
imports a module the v4 `effect` does not ship. It reads as a broken install
rather than a version mismatch. Run `npm view @effect/vitest dist-tags` and
`pnpm peers check` before believing any resolution. **Inside this monorepo**
the dependency comes from `catalog:effect`, which already pins the matching
prerelease.

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
import { Jsonc } from "@effected/jsonc";
import { Effect } from "effect";

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
  (`packages/vitest/src/internal/internal.ts:56`), piped through
  `flow(Effect.scoped, Effect.provide(TestEnv))` (`internal.ts:382`). Its type is
  `Tester<R | Scope.Scope>`, so scoped effects (`Effect.acquireRelease`, scoped
  layers) run **directly** under `it.effect`.
- **There is no `it.scoped`** (zero `scoped` matches in
  `packages/vitest/src/index.ts`; the v3→v4 migration guide
  spells the replacement out — `it.scoped(...)` becomes `it.effect(...)`,
  `it.scopedLive(...)` becomes `it.live(...)`). The Tester surface is
  `skip`/`skipIf`/`runIf`/`only`/`each`/`fails`/`prop` — **`it.effect.skipIf`
  and `it.effect.runIf` exist and are well-typed** (`packages/vitest/src/index.ts:61-62`);
  reach for them instead of hand-rolling a conditional `describe`.
- **`it.live`** (`Tester<Scope.Scope | R>`) opts into the real `Clock` and live
  runtime services. Use only when a test genuinely needs wall-clock behavior.
- **`it.effect` takes a Vitest timeout as its third argument** —
  `it.effect(name, self, timeout?: number | TestOptions)`. Any real-time elapsed
  assertion above Vitest's 5000ms default is dead code without it (see
  [references/false-greens.md](./references/false-greens.md)).
- **Never** `it("...", () => Effect.runPromise(program))`. Plain `it()` is fine
  only for genuinely non-Effect pure code (`Jsonc.stripComments`, `Yaml.equals`).
- **The rule is UNCONDITIONAL. "But the layer is fully synchronous" is not a
  carve-out.** The tempting shape is a `describe` block with a local
  `const validate = (doc) => Effect.runSync(Effect.provide(program, Svc.layer))`
  helper, justified because the service's implementation happens to be
  synchronous (a `Layer.succeed` over a sync engine such as ajv). It shipped in
  `packages/schemastore/__test__/schema-validator.test.ts`, alongside four
  sibling blocks in the same file that use `layer(...)` + `it.effect`
  correctly. Synchrony is a property of **today's implementation**, never of
  the **contract**: the member's type is `Effect<A, E>`, which permits async,
  and nothing in the type system tells you when that changes. The two costs:
  - Swap one member for an async implementation and every test in the block
    dies at *runtime* with `AsyncFiberError: An asynchronous Effect was
    executed with Effect.runSync` — no type error, no warning, and the blast
    radius is the whole `describe`.
  - A typed failure escapes `runSync` as a **throw** (in v4 the error instance
    itself, `_tag` intact — not a wrapper), so it lands in Vitest's generic
    exception path instead of `Effect.flip` / `Effect.result`, and the test
    asserts on a stack trace instead of the error channel.

  The correct shape costs one line: `layer(Svc.layer)("the shipped engine",
  (it) => { it.effect(…, () => Effect.gen(…)) })` — and it gets you
  `TestClock`/`TestConsole` and layer memoization for free.
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
import { assert, it } from "@effect/vitest";
import { Jsonc } from "@effected/jsonc";
import { Effect } from "effect";

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
`if (Exit.isFailure(exit)) { …assert… }` passes silently on success — found six
separate times in one package's suite. It is its own anti-pattern, not an
Exit-specific one.

Its second half — **genuine defects must NOT be swallowed into the typed
channel** — is what a flip-based test cannot prove (working example:
`packages/toml/__test__/hostile.test.ts` "defect passthrough"):

```ts
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";

class MyTypedError extends Error {}
const program = Effect.die(new Error("unexpected"))

it.effect("a defect stays a defect — never laundered into the typed channel", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(program);
    if (!Exit.isFailure(exit)) {
      assert.fail("expected a defect, got a success");
    }
    assert.isFalse(exit.cause.reasons.some(Cause.isFailReason)); // NOT a typed Fail
    const die = exit.cause.reasons.find(Cause.isDieReason);
    assert.instanceOf(die?.defect, Error);          // the ORIGINAL error, unmasked
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

## Providing test / mock layers

`layer(...)` applies to **any service in a test's `R` — owned or consumed**. Its
signature takes any `Layer.Layer<R, E>`; nothing requires the package under test
to declare the service. A package that owns no services but *consumes*
`Path.Path` or `FileSystem.FileSystem` needs suite-boundary layers most.

```ts
import { assert, describe, layer } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";

class Foo extends Context.Service<Foo, string>()("Foo") {
  static readonly layer = Layer.succeed(Foo, "foo");
}

describe("foo", () => {
  layer(Foo.layer)((it) => {
    it.effect("gets foo", () =>
      Effect.gen(function* () { assert.strictEqual(yield* Foo, "foo"); }));
  });
});
```

### `layer()` memoizes; plain `Effect.provide` does NOT. That asymmetry is the whole decision

The top-level `layer` builds its layer once per group through a `MemoMap` and an
`Effect.cached` build (`packages/vitest/src/internal/internal.ts:264,266,268`),
keeps the scope open for the group, and closes it in `afterAll`. A per-test
`.pipe(Effect.provide(L))` carries no memo map and rebuilds per test.

**But that is per-TEST, not per-provide: NESTED provides memoize constituent
consts.** Within one running effect, `Effect.provide` memoizes layers by
reference — an inner `Effect.provide(Layer.mergeAll(SharedConst, Variant))`
under an outer provide that already built `SharedConst` serves the **outer**
build of it, even though the `mergeAll` composition is a fresh reference
(nested builds once and the inner read sees the outer
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

Other `layer(...)` mechanics (surface checked against
`packages/vitest/src/index.ts:112-127` and `:241-252`):

- The block hands you an `it` scoped to `R` (a `MethodsNonLive<R>`), and
  **`MethodsNonLive` has no `.live`** — a wall-clock test that also needs the
  group's layer goes **outside** the block as a top-level `it.live(...)` with
  `.pipe(Effect.provide(TheLayer))`.
- Nest extra deps with `it.layer(BarLayer)("nested", (it) => { … })` — the
  nested form takes **`concurrent` and `timeout` only** (no `memoMap`, no
  `excludeTestServices`), forks the parent's memo map and inherits the parent's
  `excludeTestServices` setting (`internal.ts:300-301`).
- `layer(L, { excludeTestServices: true })` runs the group **without** the
  `TestClock`/`TestConsole` overrides — the block-wide alternative when every
  test in the group needs the real clock, rather than pulling one wall-clock
  test outside as its own top-level `it.live`; see
  [references/false-greens.md](./references/false-greens.md) for a worked,
  runnable pair.
- A mock service is a `Context.Service` with a test `Layer`, swapped
  `Live` → `Test` at this boundary, never inside test bodies.

**Testing a boundary-tier package that does real IO needs no platform package.**
`Path.layer` and `FileSystem.layerNoop(partial)` both come from `effect` core
(`Path.ts:867`; `FileSystem.ts:765` — there is **no** `FileSystem.layer` in core,
only `layerNoop`), so `@effected/walker` tests filesystem behavior with zero
`@effect/platform-node` devDependency:

```ts
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

layer(Path.layer)("path ops", (it) => {
  it.effect("Path is in R, no Effect.provide in the body", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.strictEqual(path.dirname("/a/b"), "/a");
    }));
});

layer(FileSystem.layerNoop({ exists: (p) => Effect.succeed(p === "/a/.rc") }))(
  "stubbed filesystem", (it) => {
    it.effect("fs.exists consults the stub", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        assert.isTrue(yield* fs.exists("/a/.rc"));
        assert.isFalse(yield* fs.exists("/a/other"));
      }));
  });
```

**`layerNoop`'s unstubbed members answer in THREE different ways, and each way
is a different bug.** Two half-truths circulate about this and both are wrong:
"every unstubbed member fails typed `NotFound`" and "every unstubbed member
dies". `makeNoop` (`FileSystem.ts:636`) splits them:

| members | unstubbed behavior | the trap |
| --- | --- | --- |
| `readFile`, `readFileString`, `readDirectory`, `stat`, `access`, `open`, `realPath`, `readLink`, `copy*`, `link`, `symlink`, `rename`, `truncate`, `utimes`, `glob`, `write*`, `sink`, `stream`, `watch` | typed `NotFound` failure (`FileSystem.ts:575`) | a package reading `NotFound` as domain-level "absent" treats it as a legitimate answer, so the stub silently supplies **empty fixtures** |
| `exists` → `false`, `remove` → `Effect.void` | **silent success** (`:657`, `:696`) | not a failure at all — a delete that never happened reports done |
| `makeDirectory`, `makeTempDirectory{,Scoped}`, `makeTempFile{,Scoped}` | `Effect.die("not implemented")` (`:663`–`:676`) | a **defect**: `Effect.catch` and every typed handler are blind to it |

The consequence the third row buys you: production code that defensively
absorbs a filesystem failure —
`fs.makeDirectory(d).pipe(Effect.catch(() => Effect.void))` — **cannot** absorb
it, so the first pipeline step that creates a directory kills every unrelated
test in the suite at once, and 20 simultaneous failures read as "I broke the
layer wiring", not "one new step calls `makeDirectory`". Reading the *first*
row's members and generalising is how that gets mis-diagnosed: `readDirectory`
is absorbable, `makeDirectory` is not.

**None of this is a reason to stub `layerNoop` better — it is the argument for
`@effected/memfs`.** This repo's standing rule (root `CLAUDE.md`): a test
needing `FileSystem` provides `@effected/memfs`, never a hand-rolled
`layerNoop` double, because `layerNoop` is deny-by-default and a stub encodes
only what its author remembered. `MemoryFileSystem` implements all three rows
honestly — a directory really is created, a removal really removes — so
misbehaviour is injected as a **fault handler**, not as a stub body. Keep
`layerNoop` for the one-trivially-stubbed-member case only. Same tier:
**`readFileString` strips a leading BOM** (`FileSystem.ts:508` decodes
`impl.readFile` through `TextDecoder` at `:511`, default `ignoreBOM: false`)
→ [references/false-greens.md](./references/false-greens.md).

**Beyond a single trivially-stubbed member, prefer `@effected/memfs` over a
hand-rolled `layerNoop` stub.** `MemoryFileSystem.layerWith(seed)` — seed:
absolute POSIX path → `string` | `Uint8Array`, parents auto-created — provides
a real in-memory `FileSystem` whose unseeded reads fail typed `NotFound`,
where a hand stub answering unarranged reads with `""` produces exactly the
silent false green above (a phantom file parsing as empty; that stub shipped
a real dropped-changeset bug, which is why the package exists).
`layerWith` is a parameterized layer factory: bind the result to a `const`
(memoization discipline), `Layer.fresh` for per-test isolation.

A suite-boundary layer cannot vary per test, so several filesystem fixtures need
**one `layer(...)` block per fixture** — the house shape in
`packages/walker/__test__/`.

**Every stub effect goes through `Effect.suspend`.** A recorder that pushes
eagerly logs calls that never executed — `layerNoop({ readFileString: (p) => {
calls.push(p); … } })` records a read that was only *described*. Worked probe →
[references/false-greens.md](./references/false-greens.md).

### Faulting ONE method of a real layer

For "behaves like the real service except this one method fails on demand",
`layerNoop` is the wrong tool (it stubs everything) and there is still no
`FileSystem.layerWith` / `Layer.mapService` in the vendored source (no `export const mapService` in `Layer.ts`). The house recipe is
`Layer.effect` + spread the base + `Layer.provide(base)` — with
`Layer.updateService` (`Layer.ts:2067`) as the shorter form when the subject is
itself a layer, and `Layer.mock` (`Layer.ts:2308`) for partial stubs that die
loudly. Full scaffold and the three ways to get the spread wrong →
**[references/fault-injection.md](./references/fault-injection.md)**.

### The env seam: swap `ConfigProvider`, never `process.env`

Code that reads its environment through `Config.*` — `GITHUB_STEP_SUMMARY`,
a token, a feature switch — has a test seam already, and it is **not** in `R`.
`ConfigProvider.ConfigProvider` is a `Context.Reference` whose default is
`fromEnv()` (`ConfigProvider.ts:342`), so a `Config` read requires nothing and
resolves the provider off the fiber. The consequence cuts both ways: nothing
forces a test to provide one (so a suite silently reads the *real* process
env), and any test can replace it as ordinary layer provision:

```ts
import { assert, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Option } from "effect";

const program = Effect.gen(function* () {
  const summaryFile = yield* Config.option(Config.String("GITHUB_STEP_SUMMARY"));
  return summaryFile;
});

const env = (record: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: record }));

it.effect("writes the step summary when the env names a file", () =>
  program.pipe(
    Effect.provide(env({ GITHUB_STEP_SUMMARY: "/tmp/summary.md" })),
    Effect.map((summaryFile) => assert.deepStrictEqual(summaryFile, Option.some("/tmp/summary.md"))),
  ));

it.effect("is silent when the variable is unset", () =>
  program.pipe(
    Effect.provide(env({})),
    Effect.map((summaryFile) => assert.deepStrictEqual(summaryFile, Option.none())),
  ));
```

`ConfigProvider.fromEnv({ env })` takes an explicit record and never touches
`process.env` when one is given (`ConfigProvider.ts:926`); `ConfigProvider.layer`
wraps a provider in `Layer.succeed(ConfigProvider)` (`ConfigProvider.ts:667`).
An empty record is the "variable unset" case — spell it, because the default
provider would otherwise answer from whatever the developer's shell exports.
The trap this replaces: mutating `process.env` in `beforeEach`, which leaks
across tests and cannot be scoped to one `Effect.provide`. `effect-v4-idioms`
covers the same reference from the production side.

## Property testing with `it.effect.prop` and `it.prop`

Feed a Schema (or class — the class *is* the schema) directly as an arbitrary.
The engine is core's native **`effect/unstable/arbitrary`**, not
fast-check — there is no `FastCheck` module: both `it.prop` and `it.effect.prop`
compile every input through
`Arbitrary.isArbitrary(input) ? input : Arbitrary.schema(input)`
(`packages/vitest/src/internal/internal.ts:86-93`) and run
`Arbitrary.checkEffect` (`:117`), so inputs may be Schemas, `Arbitrary`
values, or a mix, in the array or the named-record form:

```ts
import { assert, it } from "@effect/vitest";
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

const Sample = Schema.Struct({
  name: Schema.String,
  count: Schema.Int.check(Schema.makeFilter((n) => !Object.is(n, -0))), // Yaml.stringify drops -0's sign
});

it.effect.prop("parse recovers what stringify produced", [Sample], ([value]) =>
  Effect.gen(function* () {
    const text = yield* Yaml.stringify(value);
    assert.deepStrictEqual(yield* Yaml.parse(text), value);
  }),
  { arbitrary: { runs: 200, size: 64 } },
);

const Name = Arbitrary.schema(Schema.Literals(["Ada", "Grace"]));
it.prop("mixed inputs", { name: Name, n: Schema.Int }, ({ name, n }) => typeof name === "string" && Number.isInteger(n));
```

The options bag is **`arbitrary?: Arbitrary.CheckOptions`** on the
`timeout`/`TestOptions` argument (`packages/vitest/src/index.ts:104,157`):
`{ runs, size, maxDiscards, maxShrinks, seed, replay }` (`Arbitrary.ts:182`).
There is **no `fastCheck: { numRuns }` option** — `numRuns` is `runs`, `path` is the
opaque `replay` token, `maxSkipsPerRun` is one absolute `maxDiscards`. A raw
fast-check arbitrary in the inputs is a type error and a runtime failure;
compose an `Arbitrary` instead. The module's surface, the fast-check → native
translation table (`constantFrom` → `Schema.Literals`, `array` →
`Schema.Array(...).check(isLengthBetween)`, `stringMatching` → `isPattern`,
`oneof` over Arbitraries → `flatMap` over a Schema-generated index — there is
**no** `oneof`/`constantFrom`/`array`/`weighted` in the module) and the
declaration-level `toCodecArbitrary` contract live in
`effect-v4-schema/references/11-generation-and-tooling.md`. What follows is
what a probe settled about **this repo's** thirteen migrated property suites:

- **The `size` clamp silently shrinks a domain.** Every unconstrained string
  and array length is generated up to `min(maxLength, max(minLength, size))`
  with `size` defaulting to **10** (`internal/arbitrary/schema.ts:1037-1038`,
  `:1252-1253`; `runner.ts:464,605`), ramping from 0 across the runs. A
  `Schema.String.check(Schema.isMaxLength(40_000))` input never exceeded 10
  characters at the default and reached 40 000 with `arbitrary: { size: 40_000 }`.
  A byte-budget or long-input property that does not pass `size: <cap>`
  tests tiny inputs and greens for the wrong reason (`packages/github/__test__/resources2.test.ts`
  is the worked case). Unbounded `Schema.Int` has magnitude `size²` (±100) —
  bound it with `isBetween` when the property is about a 32-bit domain.
- **A brand whose check is a bare `makeFilter` EXHAUSTS instead of hanging.**
  The engine budgets rejections and fails typed — `SampleError { generated: 0, discards: 101 }`
  in under a millisecond, or `Exhausted` from `it.prop` — and an `optionalKey`
  field of that type is simply never populated, so the property never
  exercises it. Fix the domain, not `maxDiscards`: a `Schema.Literals` of real
  values, or an `arbitraryConstraint` on the filter
  (`packages/lockfiles/__test__/roundtrip.property.test.ts` header is the
  worked case).
- **The generator emits `-0`.** Always for `Schema.Number`/`Finite`, and for
  `Schema.Int` whenever the effective lower bound is `-1` — which an
  **unbounded** `Schema.Int` has during the early small-size runs
  (`internal/arbitrary/model.ts:629`, where a lower bound of `-1` yields the
  range `{ minimum: -0 }`, and `:570`, which returns that bound as-is;
  `checkEffect(Arbitrary.schema(Schema.Int), (n) => !Object.is(n, -0))` is
  Falsified within the first ten runs, and `formatCheckFailure` prints the
  shrunk input as `0`, hiding the sign). Both parsers read `-0` back (`JSON.parse("-0")` and
  `Yaml.parse("-0")` are both `-0`), but both stringifiers drop the sign
  (`JSON.stringify(-0) === "0"`, and `Yaml.stringify(-0)` is `"0\n"`), so a round-trip property
  over serialized numbers excludes it —
  `Schema.Int.check(Schema.makeFilter((n) => !Object.is(n, -0)))` — rather
  than letting `deepStrictEqual` fail on `+0`/`-0`
  (`packages/jsonc/__test__/Jsonc.test.ts`, `packages/yaml/__test__/Yaml.test.ts`).
- **A partial dictionary is a Struct of `optionalKey`.** `Schema.Record(Schema.Literals([...]), V)`
  always emits **every** key (200 samples, key count always 3), and
  `Schema.Array(Schema.Tuple([K, V])).check(Schema.isUniqueKey())` over a
  tiny key domain samples lengths 0-3 but never the *some-keys-present*
  dictionary a lockfile carries. `Schema.Struct({ a: optionalKey(V), b: optionalKey(V) })`
  samples key counts 0, 1, 2 and 3.
- **`isPattern` regexes must be lookaround-free and flag-free.** The native
  regexp compiler returns `undefined` for lookahead/lookbehind, backreferences
  and the `i`/`m`/`v` flags (`internal/arbitrary/regexp.ts:344,350,832`), and
  the string node then **silently drops the pattern** (`schema.ts:1024-1025`)
  and filters random strings — which exhausts for any selective pattern
  (`/^(?=.*[0-9])[a-f0-9]{8}$/` and `/^[a-f]{8}$/i` both died with
  `discards: 201`). Rewrite `/^(?=.*[A-Za-z-])[0-9A-Za-z-]+$/` as
  `/^[0-9]*[A-Za-z-][0-9A-Za-z-]*$/` (`packages/semver/src/SemVer.ts`,
  `packages/schema-org/src/NodeRef.ts`). Hostile-unicode input is generated
  as **code points** (`Schema.Array(Schema.Int.check(isBetween({ minimum: 0, maximum: 0x10ffff })))`
  mapped through `String.fromCodePoint`), because the native string
  generator stays in printable ASCII and the module has no
  `fc.string({ unit: "binary" })` equivalent.
- **Derivation composes through `Schema.Union` of `Schema.Class` members, and
  the generated values are REAL class instances** — `instanceof` holds for
  each member and every element is one of them, verified directly against the
  native engine. Code under test that branches on
  `x instanceof StyleVote` takes the real branch. In-repo reference:
  `packages/yaml/__test__/inference.test.ts`.
- **`it.prop` accepts a Schema directly.** Both runners share `makeArbitrary`
  (`internal.ts:89`). Hand-built inputs are `Arbitrary` values, not
  `FastCheck.*` ones.

**Reading a property failure.** `@effect/vitest` dies with
`Arbitrary.formatCheckFailure` (`Arbitrary.ts:314`): runs, shrinks, the
**shrunk input**, the failure and the **replay token**. The vitest-agent
reporter that owns this repo's CLI output compacts that to its first line —
`Property falsified after 33 run(s) and 1 shrink(s)` — and drops the input
and the token (a deliberately falsified control shows it).
The terminal stays the agent reporter's, but
`pnpm exec vitest run --project <p> --coverage.enabled=false --reporter=json --outputFile=<path>`
still writes the full message to the file (`Shrunk input: [5]` /
`Replay: [0,"1",32,3,[1],"ReturnedFalse"]`). Re-run with `arbitrary: { replay }` to reproduce
the shrink path — and pin the counterexample as an ordinary regression test,
because replay tokens are not promised across releases of the unstable module.

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
locks). This is not fixable by adjusting harder:
virtual time cannot know when un-clocked real work will complete. The escape
hatch is **`it.live` for exactly those tests** — real clock, real I/O, one
timeline — placed **outside** the `layer()` block per the `MethodsNonLive`
shape above. Keep the rest of the suite on `it.effect`; the hatch is per-test,
not per-file.

### …and it starts at the EPOCH, so clock *reads* return 1970

The quiet half: `it.effect` starts the `TestClock` at time zero, so anything
that *reads* the clock computes against **1970-01-01T00:00:00.000Z**. The start
time is source-visible — `TestClock`'s constructor opens with
`let currentTimestamp: number = new Date(0).getTime()` (`TestClock.ts:257`), and
the migration guide describes `TestClock.layer()` as creating an "epoch-based
test clock" — and the downstream consequence is directly observable
(`DateTime.now` inside a bare `it.effect` is exactly the epoch). A CLI
resolved **zero** Node versions because against a 1970 "now" every release was
still unreleased; any TTL or "newer than N days" check inverts. Set the clock
with `TestClock.setTime(...)` whenever the code under test reads time.

### Driving it

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
  (property generation is `effect/unstable/arbitrary`), not `@effect/vitest`.
- **Do not manually provide `TestClock.layer()` under `it.effect`.** They
  compose — `Clock` is a `Context.Reference` (`Clock.ts:189`), `TestClock.layer()`
  merely sets it via `Layer.effect(Clock.Clock)` (`TestClock.ts:436`), and
  `adjust` (`:507`) resolves its clock through `testClockWith`, which reads
  whatever is ambient: `fiber.getRef(Clock.Clock) as TestClock`
  (`TestClock.ts:471`). Nothing breaks, but drop the provide: a nested TestClock
  captures its `liveClock` at build time (`TestClock.ts:254`), so its "live"
  clock **is** the outer TestClock — `withLive` (`:278`) returns virtual time
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
applied and unrestored → [references/false-greens.md](./references/false-greens.md).

## `it.effect` also intercepts CONSOLE output — including `Effect.log*`

`TestEnv` installs `TestConsole` alongside the clock, so a test spying on the
real `console.log` to capture Effect's output silently captures **nothing** —
and **auditing for `Console.*` call sites is insufficient**, because Effect's
default logger writes through the same ref. The identity is source-visible, not
folklore: `Console.Console` **is** `effect.ConsoleRef` (`Console.ts:83`),
`TestConsole.layer` is `Layer.effect(Console.Console)(make)`
(`testing/TestConsole.ts:294`), and `Logger.ts:269`, `:309`, `:363` all read
`options.fiber.getRef(effect.ConsoleRef)`. One repo's audit cleared a
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

A green suite proves nothing about the properties no test can observe. In one
package (`@effected/walker`), **eight** distinct mutants each survived a fully
green suite; a later session turned up three more tests that were green,
plausible, and **structurally incapable of failing**.

The discipline: **capture a baseline** (`git status --porcelain > /tmp/baseline`),
break the implementation in the way the property forbids (with the editor —
never `git checkout`/`git stash`, other work lives in the tree), watch that
exact test go red, revert, and confirm the status matches the **baseline**, not
that it is empty.

- **The assertion must DISCRIMINATE** — confirm the test fails *for the right
  reason*, not merely that it fails.
- **The failure to look for is a rule with no input that could falsify it** —
  not a missing test. Ask of every rule: *what input would make this rule fire
  alone, and does it exist?* That input is one that is **wrong in exactly one
  way**; if you cannot name it, the rule is decoration however green the suite.
  A rule can be unfalsifiable because a sibling clause always catches the
  fixture first, because every near-miss also misses a second requirement,
  because only one of the rule's **two code paths** ever exercises it, or
  because a depth is never reached. So mutate **per clause and per path**:
  **two code paths implementing one rule are two things to pin, not one**, and
  a test covering *a* path through a rule does not pin the rule.
- **`as const satisfies ReadonlyArray<Union>` is the type-level member of this
  family: it enforces NOTHING about exhaustiveness.** It reads like a
  compile-time coverage check, and the comment above it usually claims one —
  "a new union member is noticed here". `satisfies` only asserts the listed
  literals are *assignable to* the union; it never asserts the list *covers*
  it. Type-checked at TypeScript 7 in this repo: with
  `type WriteChange = "none" | "annotations" | "created" | "deleted"`, the line
  `["none", "annotations", "created"] as const satisfies ReadonlyArray<WriteChange>`
  compiles **clean**, while the control `["none", "bogus"] as const satisfies …`
  errors — so the construct is live, it just answers a different question than
  the comment claims. Add `deleted` to the union and nothing goes red. The two
  spellings that do fire (both errored on the same file, same run):

  ```text
  // 1. residue must be empty
  type Exhaustive = Exclude<WriteChange, (typeof covered)[number]> extends never ? true : never;
  const _check: Exhaustive = true;      // TS2322: 'true' is not assignable to 'never'

  // 2. a total record over the union
  const table = { none: 0, annotations: 0, created: 0 } satisfies Record<WriteChange, number>;
  //    TS2741: Property 'deleted' is missing …
  ```

  (Deliberately non-compiling: each comment names the compile error that is
  the point of the example — a `WriteChange` union missing `"deleted"` from
  the `covered`/`table` list.)

  Same test as any other rule in this list: *what input would make this fire
  alone?* For the `satisfies` array, no input exists — a compile-time guard
  that cannot fail is decoration exactly as a test that cannot fail is.
- **One assertion, one rule.** A single assertion covering two rules goes red
  for either and proves neither — split it.
- **A passing test is evidence about the path it takes, not about the rule it
  appears to test.**
- **Before acting on "nothing found", run a control that FIRES.** An absence
  result and a broken query are indistinguishable at the call site — a
  surviving mutant, a zero-match grep and a projection that dropped the field
  all look like a true negative. Prove the query matches something you know is
  there first, and **make the control's expected answer non-zero**: a control
  returning zero when zero is correct looks exactly like success on a broken
  query. And **run the control against a KNOWN-GOOD input, never the suspect
  one** — a control that varies more than the thing under test confirms whatever
  you already believe (a `grep -c ""` run against the one pathological file
  "proved" `grep` itself was broken; it was not).
- **Read the failure TEXT; never infer a catch from a missing pass line.** A
  mutant is verified only once you have seen the assertion message and it names
  the property you expected to break. Empty output is a **failed experiment**,
  not a dead mutant and not a broken toolchain: re-run unfiltered, and scope the
  suspicion to the input — the filter, the invocation, the fixture — before the
  tool.
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

`Tests: 0/0 passed` is a FAILED run whose **summary line** says passed (a
filter that matched no test file; the separate `ERR_LOAD_URL` a repo suffers
while its config declares a cwd-relative `globalSetup` path is a config defect
to fix, not a cwd rule to obey); `TestConsole.logLines` accumulation; the eager
`layerNoop` recorder; `PubSub.takeAll` hanging on an empty subscription; timing
gates lying under coverage; a green suite that fails the vitest **process**
because a test left `process.exitCode` set; a big green count for a surface the
suite never calls; a helper used on **both sides** of every comparison, which
agrees with itself however broken it is; an `Effect.timeout` guard that never
fires — under `it.effect` any guard is inert until `TestClock.adjust` passes
it, and under a real clock a guard of 5 seconds or more loses to vitest's own
default; a forked fiber's failure that is never observed anywhere unless the
fiber is joined. Each with its probe →
**[references/false-greens.md](./references/false-greens.md)**.

**Zero collected tests is never a pass — read BOTH the Tests line and the exit
code.** A filter that matches no test file prints `Tests: 0/0 passed` and exits
**1**: the Tests line is the liar and the exit code is honest. A test file that
throws at load time is reported as `✗ test suite failed to load`, naming the
file and the throw, and exits 1. A passing subset run under `--coverage` exits
0, because the `@vitest-agent/plugin` reporter skips thresholds on partial runs
(`Coverage thresholds skipped: partial run`). Treat any disagreement between
the two signals as the alarm. Read `unhandledErrors` alongside both: a
`ChildProcess` with no `error` listener re-throws asynchronously *after* the
failure was correctly reported, and 15 green tests carried a live defect that
only that field showed.

**Run vitest from the repo root.** From inside `packages/<pkg>`, vitest does
not load the root config: it runs with the package directory as its root, so
the repo's projects, setup files and reporter are all absent. A bare
`vitest run` there still runs that package's files under default settings,
while `vitest run --project @effected/<pkg>` fails at startup with
`No projects matched the filter` (exit 1). From the root, `--project <name>`
selects one project. A positional arg is not a path: it is a **substring
matched against each test file's path**. `ckfiles` selects `@effected/lockfiles`'
tests from the root, which path resolution would not predict. Never
`--passWithNoTests` — it is the one flag that turns a zero-match run green
(exit 0).

An `ERR_LOAD_URL` naming a `vitest.setup.ts` inside a package directory means
the config declares `globalSetup` as a cwd-relative path. Resolve it against
the config file (`fileURLToPath(new URL("vitest.setup.ts", import.meta.url))`).
The setup file it names is not one you were meant to create; creating it forks
the setup permanently.

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
- **A probe writes no file.** A temporary probe left under `__test__/` is
  collected by the ordinary suite and inflates the `Tests:` count, and that
  inflation is indistinguishable from added coverage — which is exactly what a
  count-delta review ("+5 new, −1 removed, no assertion changed") depends on.
  **Do not fix this with an exclude pattern**: an exclude catches only names
  someone predicted and fails silently when it misses. Instead run the probe as
  a script that never touches disk, **from inside the package**:

  ```bash
  cd packages/<name> && node --input-type=module -e '<script>'
  ```

  `-e` writes nothing. Running from inside the package is what makes bare
  specifiers (`effect`, a workspace sibling) resolve: under pnpm's store layout
  the **importer's** location decides resolution, so the same script run from
  the repo root fails with `ERR_MODULE_NOT_FOUND`. If a probe genuinely needs a
  file, put it in the repo's sanctioned scratch venue (in this monorepo,
  `scratchpad/`), never in `__test__/`. The zero-collection warning from
  `@vitest-agent/plugin` is a backstop, not the mechanism.
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
