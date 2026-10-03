---
name: effect-v4-testing
description: Use when writing, reviewing, or fixing tests for Effect v4 code with @effect/vitest — it.effect + Effect.gen as the default runner, asserting typed errors via Effect.flip or Effect.result (Exit + Cause for defects), providing test/mock layers with layer(...) for any service in R (owned or consumed), fault-injecting one method of a real layer, property tests with it.effect.prop over a Schema, TestClock for time-dependent logic, converting a plain-Vitest repo, and the mutate-the-edges discipline for proving a suite can actually fail — the discriminating input wrong in exactly one way, per-clause and per-path mutation, and the positive control a "nothing found" result needs before it's believed.
when_to_use: "it.scoped removed, Arbitrary size clamp/-0/exhaustion/dropped-regex traps, Path.layer + @effected/memfs need no platform package, vi.mock must import vi from vitest, layer() memoizing while Effect.provide does not, TestConsole swallowing Effect.log* through ConsoleRef, a small real delay hanging the virtual clock, Tests: 0/0 passed lying while the exit code is honest, a project-filtered run from inside a package not loading the root config, TestClock starting at the epoch (1970), an eagerly-recording layerNoop stub, a narrowing if with no else branch, structural checks over source text (import walkers, export assertions, comment strippers), the two-latch rule for concurrency-leak tests, unhandledErrors and a stray process.exitCode making a green suite lie"
---

# Effect v4 testing with `@effect/vitest`

`@effect/vitest` re-exports Vitest, so it is the single entrypoint for test
APIs — with one exception (`vi.mock`, below). Effect programs run through
`it.effect`, never through a bare `it()` that calls `Effect.runSync`/
`runPromise`. Our house test files (`packages/jsonc/__test__/Jsonc.test.ts`,
`packages/yaml/__test__/Yaml.test.ts`) are the canonical shapes. (The
`effect/testing/*` modules — TestClock, TestConsole, TestSchema — and the
property engine `Arbitrary` are indexed in
`effect-v4-module-index`; this skill owns how to use them. There is no
`FastCheck` module.)

**Migrating a plain-Vitest Effect repo? Adopt `@effect/vitest`.** A repo whose
tests are plain Vitest is not "nothing to migrate on the testing axis": add
`@effect/vitest` and route Effect-returning tests through `it.effect`. The
conversion has its own traps →
**[references/migrating-a-repo.md](./references/migrating-a-repo.md)**.

**Testing a specific front end or a repo-shape check routes elsewhere first.**
This skill owns the general `@effect/vitest` mechanics; a front end's own
testing subpath owns the rest: testing a CLI bin → `effect-v4-cli` (`CliTest`); an Ink screen, a wizard or a live view → `effect-v4-cli` (`CliUiTest`: its `session` transcript, and its snapshot serializer registered through Vitest's `snapshotSerializers` config, snapshots being the one place a test needs `expect`);
testing an MCP server → `effect-v4-mcp` (`McpHarness`, `McpProbe`); a
monorepo's own repo-shape checks (layering, source boundaries, packed
installs) → `@effected/workspaces/testing` (see `effected-packages`).

**Install it from the same catalog as `effect`, so it resolves to the same version** — never bare and never from a dist-tag. Effect releases `effect` and every `@effect/*` package together at one shared version, so `@effect/vitest` must resolve to exactly the version `effect` does. A dist-tag (`latest`, `beta`, `rc`, `snapshot`) is a moving pointer that can resolve to a version other than the one `effect` resolves to.

The failure of a mismatch names neither package: a v3 `@effect/vitest` installed beside v4 `effect` loads with only a one-line `Issues with peer dependencies found` warning; `pnpm peers check` then lists unmet `effect ^3` and `vitest ^3` peers, and the test file fails to load with `Cannot find module '…/effect/dist/Arbitrary.js'`, because the v3 package imports a module the v4 `effect` does not ship. It reads as a broken install rather than a version mismatch. Run `pnpm peers check` and compare `@effect/vitest`'s resolved version with `effect`'s in the lockfile before believing any resolution. **Inside this monorepo** the dependency comes from `catalog:effect`, which carries both at the same range.

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
  (`packages/vitest/src/internal/internal.ts:59`), piped through
  `flow(Effect.scoped, Effect.provide(TestEnv))` (`internal.ts:386`). Its type is
  `Tester<R | Scope.Scope>`, so scoped effects (`Effect.acquireRelease`, scoped
  layers) run **directly** under `it.effect`.
- **There is no `it.scoped`** (zero `scoped` matches in
  `packages/vitest/src/index.ts`; the v3→v4 migration guide
  spells the replacement out — `it.scoped(...)` becomes `it.effect(...)`,
  `it.scopedLive(...)` becomes `it.live(...)`). The Tester surface is
  `skip`/`skipIf`/`runIf`/`only`/`each`/`fails`/`prop` — **`it.effect.skipIf`
  and `it.effect.runIf` exist and are well-typed** (`packages/vitest/src/index.ts:65-66`);
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

**Genuine defects must NOT be swallowed into the typed channel** — the half a
flip-based test cannot prove. Assert `Effect.exit`, that the cause holds no
`Fail` reason (the discriminating line), and that the `Die` defect is the
ORIGINAL error. **Assert helpers are never type predicates** — narrow with a
real `if`; and `assert.deepStrictEqual` against literal-typed encodes needs an
explicit `<unknown>` type argument. Worked example and both traps →
**[references/asserting-errors.md](./references/asserting-errors.md)**.

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

The top-level `layer` builds once per group and keeps the scope open until
`afterAll`; a per-test `.pipe(Effect.provide(L))` rebuilds per test. Nested
provides inside one running effect memoize constituent consts by reference, so
a fault-injected variant can silently fall back to the REAL services already
built outside.

**Per-test provide is the SAFE default; collapsing a suite onto a
suite-boundary `layer()` is the RISKY move.** Build-once means every stateful
resource is cumulative across the group — `TestClock.adjust`, in-memory
stores, TTL expiry, `TestConsole.logLines` — so a clock-driving test must NOT
live inside a `layer()` block. Pre-flight before collapsing, the nested-layer
and `excludeTestServices` forms, and why `MethodsNonLive` has no `.live` →
**[references/providing-layers.md](./references/providing-layers.md)**; worked
failures in [references/migrating-a-repo.md](./references/migrating-a-repo.md).
A mock service is a `Context.Service` with a test `Layer`, swapped `Live` →
`Test` at this boundary, never inside test bodies.

**Testing a boundary-tier package that does real IO needs no platform package.**
`Path.layer` comes from `effect` core (`Path.ts:867`) and the filesystem double
is `@effected/memfs`, a pure package with no `node:*` import — core ships
**no** `FileSystem.layer`, only the deny-by-default `layerNoop` (`FileSystem.ts:765`),
which is not a double
([references/providing-layers.md](./references/providing-layers.md)). So `@effected/walker` tests filesystem behavior
with zero `@effect/platform-node` devDependency:

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { assert, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

layer(Path.layer)("path ops", (it) => {
  it.effect("Path is in R, no Effect.provide in the body", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.strictEqual(path.dirname("/a/b"), "/a");
    }));
});

const Volume = Layer.merge(Path.layer, MemoryFileSystem.layerWith({ "/a/.rc": "" }));

layer(Volume)("seeded filesystem", (it) => {
  it.effect("fs.exists consults the volume", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      assert.isTrue(yield* fs.exists("/a/.rc"));
      assert.isFalse(yield* fs.exists("/a/other"));
    }));
});
```

**`layerNoop`'s unstubbed members answer in THREE different ways**
(`makeNoop` (`FileSystem.ts:636`) splits them) — typed `NotFound`, silent success (`exists` → `false`, `remove` → `Effect.void`), and
`Effect.die` (`makeDirectory`, `makeTemp*`), which `Effect.catch` cannot
absorb. **None of this is a reason to stub `layerNoop` better — it is the
argument for `@effected/memfs`.** This repo's rule: a `FileSystem` double is
`@effected/memfs`, never a `layerNoop` stub and never a hand-rolled `node:fs`
port stub. **Every `Effect.provide` of a memfs layer re-seeds a fresh
volume**, so assert inside the one provide or provide a pinned
`handle.layer`. The table, the BOM trap, the seed forms and the
one-`layer(...)`-block-per-fixture shape →
**[references/providing-layers.md](./references/providing-layers.md)**;
picking the memfs form, seeds, faults, case-insensitive volumes and traps →
**[references/memfs.md](./references/memfs.md)**.

**Every stub effect goes through `Effect.suspend`.** A recorder that pushes
eagerly logs calls that never executed. Worked probe →
[references/false-greens.md](./references/false-greens.md).

### Faulting ONE method of a real layer

For "behaves like the real service except this one method fails on demand",
`layerNoop` is the wrong tool. The house recipe is `Layer.effect` + spread the
base + `Layer.provide(base)`, with `Layer.updateService` as the shorter form
and `Layer.mock` for partial stubs that die loudly. Full scaffold, the source
anchors and the three ways to get the spread wrong →
**[references/fault-injection.md](./references/fault-injection.md)**.

### The env seam: swap `ConfigProvider`, never `process.env`

Code reading its environment through `Config.*` already has a test seam, and
it is not in `R`: `ConfigProvider.ConfigProvider` is a `Context.Reference`, so
a test replaces it with `Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: record })))`.
An empty record is the "variable unset" case; the default provider would
answer from whatever the developer's shell exports. Never mutate
`process.env` in `beforeEach`. Worked example →
**[references/env-seam.md](./references/env-seam.md)**.

## Property testing with `it.effect.prop` and `it.prop`

Feed a Schema (or class) directly as an arbitrary. The engine is core's native
**`Arbitrary`**, not fast-check — there is no `FastCheck` module, and **no
`fastCheck: { numRuns }` option**: the bag is `arbitrary: { runs, size, … }`.
The traps a probe settled, each with its fix in
**[references/property-testing.md](./references/property-testing.md)**:

- The `size` clamp (default **10**) silently shrinks a domain — pass
  `size: <cap>` for long-input properties.
- A brand whose check is a bare `makeFilter` EXHAUSTS instead of hanging.
- The generator emits `-0`; round-trip properties over serialized numbers
  exclude it.
- A partial dictionary is a Struct of `optionalKey`, not a `Record`.
- `isPattern` regexes must be lookaround-free, free of `i`/`m`/`v`, and carry
  `u`; otherwise the pattern is silently dropped.
- Reading a failure: the agent reporter compacts it to one line; the full
  shrunk input and replay token are in the `--reporter=json` output file. Pin
  the counterexample as an ordinary regression test.

## Time-dependent logic: `TestClock`

**`it.effect` ALWAYS installs a virtual `TestClock`. This is not opt-in.**

- **A small REAL delay anywhere under the test — usually in `src` — hangs to
  the vitest timeout** with no message pointing at the clock. Any
  `Effect.sleep`, retry schedule, timeout or polling interval needs a driven
  clock or `it.live`; grep the implementation, not only the test. A test that
  hangs for exactly five seconds: suspect wall-clock time first.
- **It starts at the EPOCH**, so clock *reads* return 1970 — set the clock
  with `TestClock.setTime(...)` whenever the code under test reads time.
- **Real async I/O interleaved with sleeps desyncs the drain loop** — use
  `it.live` for exactly those tests, outside the `layer()` block.
- **Do not manually provide `TestClock.layer()` under `it.effect`**, and never
  call `TestClock.adjust` under `it.live`.
- **Stage an interleaving with latches, not sleeps**, and a *leak* test needs
  **two** latches.

The grep pattern, the driving example, the clock-free interrupt restructure
and the source-visible reasoning →
**[references/testclock.md](./references/testclock.md)**; the two-latch probe →
[references/false-greens.md](./references/false-greens.md).

## `it.effect` also intercepts CONSOLE output — including `Effect.log*`

`TestEnv` installs `TestConsole` alongside the clock, so a spy on the real
`console.log` captures **nothing** — and auditing for `Console.*` call sites
is insufficient, because Effect's default logger writes through the same ref.
**A test whose only assertions are negative is the vacuous-pass shape**; a
positive sibling is the cheap proof the sink is live. Source identity and the
immune cases → **[references/test-console.md](./references/test-console.md)**;
`TestConsole.logLines` accumulation →
[references/false-greens.md](./references/false-greens.md).

## A test that cannot fail is worse than no test — mutate the edges

A green suite proves nothing about the properties no test can observe. The
discipline: **capture a baseline** (`git status --porcelain > /tmp/baseline`),
break the implementation in the way the property forbids (with the editor —
never `git checkout`/`git stash`, other work lives in the tree), watch that
exact test go red, revert, and confirm the status matches the **baseline**.

- **The assertion must DISCRIMINATE** — fail for the right reason.
- **The failure to look for is a rule with no input that could falsify it.**
  Ask of every rule: *what input would make this fire alone, and does it
  exist?* Mutate **per clause and per path**; **two code paths implementing
  one rule are two things to pin, not one**.
- **`as const satisfies ReadonlyArray<Union>` enforces NOTHING about
  exhaustiveness** — use a residue-must-be-empty type or a total
  `Record<Union, …>`.
- **One assertion, one rule.** A passing test is evidence about the path it
  takes, not about the rule it appears to test.
- **Before acting on "nothing found", run a control that FIRES**, with a
  non-zero expected answer, against a KNOWN-GOOD input.
- **Read the failure TEXT; never infer a catch from a missing pass line.**
  Empty output is a failed experiment.
- **Never verify a change by grepping for the text you just wrote.** Only a
  mutation finds the emit site.
- **A semantics-preserving perf fix cannot be pinned** — report it as
  fixed-but-unpinned.
- **A surviving mutant is a question about the CODE**; deleting the code is a
  legitimate answer. When sweeping, assert the on-disk state every run, and
  settle disagreeing reads against `git show HEAD:<path>`.

Full discipline, the checklist, the `satisfies` spellings that do fire and the
worked failures →
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
`layerNoop` recorder; `PubSub.takeAll` hanging on an empty subscription; a
drain test whose subscriber took every message inside `publish`, so nothing
was ever queued; `PubSub.shutdown` dropping the tail it was meant to drain; a
stream over an ended subscription repeating `PubSub.end`'s sticky final
message forever; a race that only shows below the default
`Scheduler.MaxOpsBeforeYield` budget; timing
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
**1**: the Tests line is the liar and the exit code is honest. Treat any
disagreement between the two signals as the alarm, and read `unhandledErrors`
alongside both. **Run vitest from the repo root** — from inside a package it
does not load the root config — and never `--passWithNoTests`. In a kit
monorepo, adding an export to an upstream package requires
`pnpm build --filter <upstream>` before any downstream suite runs; a load-time
`Cannot read properties of undefined (reading 'ast')` IS the stale-dist
signature. The `ERR_LOAD_URL` setup-file case and the rest →
**[references/running-the-suite.md](./references/running-the-suite.md)**.

## House conventions

- Tests live in each package's `__test__/` directory (`*.test.ts`), never
  co-located in `src/`.
- **A probe writes no file.** A probe left under `__test__/` is collected by
  the ordinary suite and inflates the `Tests:` count. Run it as a script that
  never touches disk, from inside the package:
  `cd packages/<name> && node --input-type=module -e '<script>'` →
  [references/running-the-suite.md](./references/running-the-suite.md).
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
