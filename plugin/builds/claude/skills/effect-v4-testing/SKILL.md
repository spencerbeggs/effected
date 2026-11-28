---
name: effect-v4-testing
description: Use when writing, reviewing or fixing tests for Effect v4 code with @effect/vitest, or choosing a test double — an in-memory filesystem (memfs), a fake FileSystem, ChildProcessSpawner, HttpClient, Config, Clock or Stdio — before hand-writing one. Covers it.effect + Effect.gen, asserting typed errors with Effect.flip or Effect.result, test layers via layer(...), fault-injecting one method of a real layer, it.effect.prop over a Schema, TestClock, and proving a suite can fail by mutating the edges.
when_to_use: "in-memory filesystem, memfs, fake or mock a service, test double, it.scoped removed, layer() memoizing while Effect.provide does not, TestConsole swallowing Effect.log*, TestClock at the epoch (1970), a real delay hanging the virtual clock, Tests: 0/0 passed lying, vi.mock must import vi from vitest, layerNoop stub, positive control, mutation testing, concurrency-leak tests"
---

# Effect v4 testing with `@effect/vitest`

`@effect/vitest` re-exports Vitest, so it is the single entrypoint for test
APIs — except `vi.mock`, below. Effect programs run through `it.effect`, never a
bare `it()` that calls `Effect.runSync`/`runPromise`. `effect-v4-module-index`
indexes the `effect/testing/*` modules and the `Arbitrary` engine; this skill
owns how to use them. There is no `FastCheck` module.

**Install `@effect/vitest` from the same catalog as `effect`**, never bare or
from a dist-tag: a mismatch surfaces as `Cannot find module
'…/effect/dist/Arbitrary.js'` and reads as a broken install. A plain-Vitest
Effect repo adopts `@effect/vitest` and routes Effect tests through
`it.effect`. Before you install it, convert a repo, or test Effect code without
it, load [migrating-a-repo.md](./references/migrating-a-repo.md).

**`vi.mock` is the one import that must NOT come from `@effect/vitest`.** Vitest
hoists it above all imports, so the file dies at load with `Cannot access
'__vi_import_1__' before initialization`. Write `import { vi } from "vitest"` in
any file calling `vi.mock`; `vi.fn` / `vi.spyOn` work through the re-export.

**A spy restored in `try`/`finally` inside `Effect.gen` LEAKS** — a failing
assertion leaves through the error channel. Acquire and release spies with
`Effect.acquireUseRelease` →
[references/false-greens.md](./references/false-greens.md).

## Pick the double before you write one

A hand-written double encodes only what its author remembered, and the gap
becomes a green test over broken code. Find the service in your test's `R` here
and use the double named. For anything not listed, grep the kit's construct
index:
`grep -ri "test double\|layerTest\|<service name>" "${CLAUDE_PLUGIN_ROOT}/skills/effected-packages/references/constructs/"`.

| Service in `R`, or thing under test | Use | From |
| --- | --- | --- |
| `FileSystem` | `MemoryFileSystem.layerWith(seed)` — never `FileSystem.layerNoop` or a `node:fs` stub | `@effected/memfs` ([memfs](./references/memfs.md)) |
| `Path` | `Path.layer` (POSIX) | `effect` |
| `ChildProcessSpawner` | `ScriptedSpawner.make(script)`: `{ layer, spawns }` | `@effected/commands` |
| `HttpClient` | `HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body))))` in a `Layer.succeed(HttpClient.HttpClient, …)` | `effect/http` |
| `Config` reads | `ConfigProvider.fromUnknown({ KEY: "value" })` — never `process.env` ([env-seam](./references/env-seam.md)) | `effect` |
| `Clock`, `Schedule`, timeouts | `TestClock` (already installed by `it.effect`) | `effect/testing` |
| `Stdio` | `Stdio.layerTest({ … })` | `effect` |
| `Digest`, `Mac`, `Signature`, `SecureRandom` | the real layer, no double: `Digest.layerWebCrypto` (needs nothing), `Mac.layerWebCrypto` or `Signature.layerWebCrypto` with `Layer.provide(SecureRandom.layerWebCrypto)`, or `NodeCrypto.layerDigest` / `NodeCrypto.layer`. **`NodeServices.layer` provides no crypto service, `Digest` included** — only `ChildProcessSpawner`, `FileSystem`, `Path`, `Stdio` and `Terminal` — so a test or a standalone script that hashes composes `NodeCrypto.layerDigest` beside it | `effect/crypto`; `@effect/platform-node` |
| a `Store`, or an app on `@effected/app` | `Store.layerTest({ migrations })`; `AppTest.layer(options)` | `@effected/store`; `@effected/app/testing` |
| a CLI bin; an Ink screen | `CliTest`; `CliUiTest`, whose snapshot serializer is the one place a test uses `expect` ([effect-v4-cli](../effect-v4-cli/SKILL.md)) | `@effected/cli-kit/testing`; `@effected/cli-kit/ui/testing` |
| an MCP server; an LSP server | `McpHarness`, `McpProbe` ([effect-v4-mcp](../effect-v4-mcp/SKILL.md)); `LspProbe` | `@effected/mcp-kit/testing`; `@effected/lsp/testing` |
| a JWT or OIDC verifier | `TestIssuer` | `@effected/jwt/testing` |
| an action, the GitHub API, an SBOM signer | the doubles in [testing-actions](../testing-actions/SKILL.md) | `@effected/github-actions`, `@effected/github` |
| a monorepo's own layering and packed installs | the repo-shape checks | `@effected/workspaces/testing` |

## The default runner: `it.effect` + `Effect.gen`

```ts
import { assert, it } from "@effect/vitest";
import { Jsonc } from "@effected/jsonc";
import { Effect } from "effect";

it.effect("parses objects, arrays and scalars", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* Jsonc.parse('{ "a": 1 }'), { a: 1 });
  }),
);
```

- **`it.effect` provides a per-test `Scope`, `TestClock` and `TestConsole`**, so
  scoped effects run directly under it. **There is no `it.scoped`**:
  `it.scoped` becomes `it.effect`, `it.scopedLive` becomes `it.live`.
  `it.effect.skipIf` / `runIf` exist and are well-typed. **`it.live`** opts into
  the real clock; use it only for genuine wall-clock behaviour. The third
  argument is a Vitest timeout.
- **Never `it("...", () => Effect.runPromise(program))`, and never a local
  `Effect.runSync` helper "because the layer is synchronous"** — synchrony is
  today's implementation, not the contract, and an async member later kills the
  whole block at run time. Plain `it()` is for genuinely non-Effect code.
- **Never `it("...", () => Effect.gen(...))`** — Vitest ignores the returned
  Effect and reports **green having evaluated zero assertions**.
- **Never build a fixture with `Effect.runSync`** — `yield*` it inside
  `it.effect`, or build a domain value with `X.make`.
- **`yield* import(...)` throws `(intermediate value) is not iterable`**; write
  `yield* Effect.promise(() => import("./thing.js"))`.

Before you write a helper that runs an Effect, convert `await` code to
`yield*`, or reach for `it.live`, load
[the-default-runner.md](./references/the-default-runner.md): two runner shapes
pass while testing nothing.

## Asserting on typed errors

**`Effect.flip`** (`Effect<E,A,R>`: the typed error becomes the success value)
is the house pattern, so the error never escapes as a defect:

```ts
it.effect("fails with an aggregate JsoncParseError", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(Jsonc.parse("{ bad }"));
    assert.strictEqual(error._tag, "JsoncParseError");
    assert.isAbove(error.errors.length, 0);
  }),
);
```

**`Effect.result`** (`Effect<Result<A,E>,never,R>`, the replacement for the
removed `Either`) asserts on *both* channels in one program; **`Effect.exit`**
(`Effect<Exit<A,E>,never,R>`) when you must inspect a `Cause`.

- **`Effect.flip` is WRONG for a defect** — a defect escapes it. Defects go
  through `Effect.exit`, with an explicit fail on the non-failure branch.
- **A narrowing `if` with no `else` asserts nothing on the other path.**
- **Assert helpers are never type predicates** — narrow with a real `if`; and
  `assert.deepStrictEqual` against literal-typed encodes needs `<unknown>`.

Before you assert a defect, or prove one is not swallowed into the typed
channel, load [asserting-errors.md](./references/asserting-errors.md): the
discriminating assertion is the one a first draft leaves out.

## Providing test / mock layers

`layer(...)` applies to **any service in a test's `R` — owned or consumed**
(`layer(Foo.layer)((it) => { it.effect("gets foo", () => …) })`); a package that
owns no services but consumes `Path.Path` or `FileSystem.FileSystem` needs
suite-boundary layers most.

**`layer()` memoizes; plain `Effect.provide` does NOT.** `layer` builds once per
group and closes in `afterAll`; a per-test `.pipe(Effect.provide(L))` rebuilds
per test. **Per-test provide is the SAFE default; collapsing onto `layer()` is
the RISKY move**: state is cumulative across the group (`TestClock.adjust`,
in-memory stores, TTLs, `TestConsole.logLines`), so a clock-driving test never
lives in a `layer()` block. A mock service is a test `Layer` swapped at this
boundary, never inside a test body. Before you collapse per-test provides or
nest a variant inside a provided helper, load
[providing-layers.md](./references/providing-layers.md): nested provides
memoize by reference, so a fault-injected variant can silently run the REAL
services.

**Real IO needs no platform package.** `Path.layer` (`Path.ts:931`) is core's
POSIX `Path` — tests only, never `src/` — and the filesystem double is
`@effected/memfs`. Core ships **no** `FileSystem.layer`, only the
deny-by-default `layerNoop` (`FileSystem.ts:848`), which is not a double: its
unstubbed members answer three different ways (`makeNoop` (`FileSystem.ts:712`)
splits them) — typed `NotFound`, silent success (`exists` → `false`), and
`Effect.die` (`makeDirectory`, `makeTemp*`), which `Effect.catch` cannot absorb.

- **A `FileSystem` double is `@effected/memfs`, never a `layerNoop` stub and
  never a hand-rolled `node:fs` port stub.** The one exception is an oracle test
  that runs a third-party engine reading `node:fs` itself.
- **Every `Effect.provide` of a memfs layer re-seeds a fresh volume**, so assert
  inside the one provide or provide a pinned `handle.layer`.
- **A service on `@effected/store` is tested over its real implementation** via
  a `layerMemory()` factory over `Store.layerTest`; an app on `@effected/app`
  over `AppTest.layer(options)`.
- **Every stub effect goes through `Effect.suspend`** — an eager recorder logs
  calls that never executed ([false-greens.md](./references/false-greens.md)).

Before you write a filesystem test, load [memfs.md](./references/memfs.md)
for the memfs form, seeds and faults, and
[providing-layers.md](./references/providing-layers.md) for a worked suite.

**Faulting ONE method of a real layer** is `Layer.effect` + spread the base +
`Layer.provide(base)`, with `Layer.updateService` as the shorter form and
`Layer.mock` for partial stubs that die loudly — never `layerNoop`. Before you
fault-inject, load [fault-injection.md](./references/fault-injection.md): there
are three ways to get the spread wrong.

**The env seam: swap `ConfigProvider`, never `process.env`.**
`ConfigProvider.ConfigProvider` is a `Context.Reference`, so a test replaces it
with `Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: record })))`;
an empty record is the "variable unset" case. Never mutate `process.env` in
`beforeEach`. Worked example →
[env-seam.md](./references/env-seam.md).

## Property testing with `it.effect.prop` and `it.prop`

Feed a Schema (or class) directly as an arbitrary. The engine is core's native
**`Arbitrary`**, not fast-check — there is no `FastCheck` module, and **no
`fastCheck: { numRuns }` option**: the bag is `arbitrary: { runs, size, … }`.
The traps: the `size` clamp (default **10**) silently shrinks a domain, so pass
`size: <cap>` for long inputs (`Arbitrary.array` over a `Schema.Literals` of
characters, for a custom alphabet, is under it too); a brand whose check is a
bare `makeFilter` EXHAUSTS; the generator emits `-0`; a partial dictionary is a
Struct of `optionalKey`, not a `Record`; an `isPattern` regex with lookaround,
`i`/`m`/`v` or no `u` is silently dropped; and the agent reporter compacts a
failure to one line, with the shrunk input in the `--reporter=json` output — pin
the counterexample as a regression test. Before you write a property, load
[property-testing.md](./references/property-testing.md) for each fix.

## Time-dependent logic: `TestClock`

**`it.effect` ALWAYS installs a virtual `TestClock`. This is not opt-in.**

- **A small REAL delay anywhere under the test — usually in `src` — hangs to
  the vitest timeout** with no message pointing at the clock. Any `Effect.sleep`,
  retry schedule, timeout or poll needs a driven clock or `it.live`; grep the
  implementation, not only the test.
- **It starts at the EPOCH**, so clock reads return 1970 — `TestClock.setTime`.
- **Real async I/O interleaved with sleeps desyncs the drain loop** — `it.live`
  for those tests, outside the `layer()` block. Never provide
  `TestClock.layer()` under `it.effect`, or call `TestClock.adjust` under
  `it.live`.
- **Stage an interleaving with latches, not sleeps**; a *leak* test needs two.

Before you drive a clock or test anything that sleeps, load
[testclock.md](./references/testclock.md); a test that hangs for exactly five
seconds is wall-clock time until proven otherwise.

## `it.effect` also intercepts CONSOLE output — including `Effect.log*`

`TestEnv` installs `TestConsole`, and Effect's default logger writes through the
same ref, so a spy on the real `console.log` captures **nothing** and a
`Console.*` audit misses `Effect.log*`. **A test whose only assertions are
negative is the vacuous-pass shape**; add a positive sibling. Before you assert
on output, load [test-console.md](./references/test-console.md) for the immune
emit paths.

## A test that cannot fail is worse than no test — mutate the edges

A green suite proves nothing about the properties no test can observe.
**Capture a baseline** (`git status --porcelain > /tmp/baseline`), break the
implementation the way the property forbids (with the editor — never
`git checkout`/`git stash`, other work lives in the tree), watch that exact test
go red, revert, and confirm the status matches the baseline. **The assertion
must DISCRIMINATE; one assertion pins one rule; two code paths for one rule are
two things to pin; before acting on "nothing found", run a control that
FIRES; read the failure TEXT, never a missing pass line.** `as const satisfies
ReadonlyArray<Union>` enforces nothing about exhaustiveness. A surviving mutant
is a question about the CODE, and a semantics-preserving perf fix is reported as
fixed-but-unpinned. Before you claim a suite proves a property, or believe an
empty search, load [mutation-testing.md](./references/mutation-testing.md): it
holds the checklist, the unfalsifiable-rule hunt, the `satisfies` spellings that
do fire, and why grepping for the text you just wrote verifies nothing.

**Structural checks over source text** — "this module does not reach that
dependency", "the entrypoint exports this by name" — fail silently where
ordinary assertions shout. **Raw source is SAFE for a `notInclude` check and
DANGEROUS for an `include` one** (a comment mention passes). Before you write
one, load [structural-checks.md](./references/structural-checks.md): strip LINE
comments **before** block comments, remove module specifiers, match on a word
boundary, and test the stripper itself once it is load-bearing.

## Other false greens, and reading a run

**Zero collected tests is never a pass — read BOTH the Tests line and the exit
code.** A filter that matches no test file prints `Tests: 0/0 passed` and exits
**1**: the Tests line is the liar. Read `unhandledErrors` alongside both.
**Run vitest from the repo root** (from inside a package it does not load the
root config), and never `--passWithNoTests`. **Piping vitest into `tail`,
`head` or `grep` hides its exit code** — `set -o pipefail` first, or read the
vitest command's own status. A `globalSetup` build through
`AgentPlugin.runScript` is skipped inside a 30 s window, so pin
`VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` to `1` or a test reads the previous
`dist`. Before you trust a run, or when a run's output and exit code disagree,
load [running-the-suite.md](./references/running-the-suite.md).

The rest each have a probe in [false-greens.md](./references/false-greens.md);
load it when a green run surprises you, or before you test a `PubSub`, a
timeout, a forked fiber or a concurrency window: `TestConsole.logLines`
accumulating; an eager `layerNoop` recorder; `PubSub.takeAll` hanging on an
empty subscription, a drain whose subscriber took every message inside
`publish`, `PubSub.shutdown` dropping the tail, and `PubSub.end`'s sticky final
message repeating forever; a race visible only below the default
`Scheduler.MaxOpsBeforeYield`; timing gates lying under coverage, and a timing
guard that cannot catch a loop that never returns (its control runs in a
subprocess with a hard timeout); a stray `process.exitCode` failing the vitest
**process**; a big green count for a surface never called; a helper used on
**both sides** of a comparison; an `Effect.timeout` guard inert under
`it.effect` until `TestClock.adjust` passes it, and losing to vitest's default
under a real clock at 5 s or more; a forked fiber's failure never observed
unless joined.

**Test the sync facade over the same fixture as the Effect form.** A `*Sync`
function or a `parseResult` beside an `Effect` one is a separate code path, and
a green Effect-form suite proves nothing about it: a layout only the Effect
suite had a fixture for can be discovered by the service while the facade a
consuming tool calls returns nothing.

## House conventions

- Tests live in each package's `__test__/` directory, never in `src/`. **A probe
  writes no file**: run it with `node --input-type=module -e '<script>'` from
  inside the package. Construct domain values with `X.make`, never `new`.
- **The kit asserts with `assert.*`, never `expect`** (`toEqual` →
  `deepStrictEqual`, `toBe` → `strictEqual`, `toBeInstanceOf` → `instanceOf`,
  `toBe(true)` → `isTrue`, `toHaveLength` → `lengthOf`). It is convention, not a
  constraint: in a repo whose house style is `expect`, do **not** sweep it.
- Assert that the package's own error escapes (`error._tag === "JsoncParseError"`)
  and that the schema path surfaces a `SchemaError`; the two must not drift.
- **A test that cannot fail is worse than no test** — a prototype-pollution
  guard whose payload could never mutate the asserted object, a
  `@ts-expect-error` in a tsconfig-excluded file.

## Additional resources

- [the-default-runner.md](./references/the-default-runner.md) — what `it.effect` installs and where in the source, `it.scoped`'s replacement, `skipIf`/`runIf`, `it.live`, the timeout argument, the `runSync`-helper rule and the returned-Effect table. Load when: writing a helper that runs an Effect, converting `await` code, or a test that should fail stays green.
- [asserting-errors.md](./references/asserting-errors.md) — asserting a defect with `Effect.exit`, proving a defect is not laundered into `E`, and the assert-helper typing traps. Load when: asserting a defect, a `Cause`, or a narrowed `Exit` or `Result`.
- [providing-layers.md](./references/providing-layers.md) — `layer()` versus per-test provide, nested-provide memoization, the collapse pre-flight, `layerNoop`'s three answers, the memfs rule, a `Path.layer` + memfs suite, the oracle exception, and `@effected/store` / `@effected/app` doubles. Load when: choosing a suite boundary, providing a `FileSystem` or `Path`, or a fault-injected variant behaves like the real service.
- [memfs.md](./references/memfs.md) — picking the memfs form by where you assert, seeds, mutating between calls, faults, case-insensitive volumes, traps and what the volume cannot see. Load when: writing any test that needs a filesystem.
- [fault-injection.md](./references/fault-injection.md) — the spread-the-base scaffold, `Layer.updateService`, `Layer.mock`, a deterministic temp directory, faulting an injected port, and two instances of one layer. Load when: one method of a real service must fail on demand.
- [env-seam.md](./references/env-seam.md) — swapping `ConfigProvider` for an env record. Load when: the code under test reads `Config` or an environment variable.
- [property-testing.md](./references/property-testing.md) — `it.effect.prop` and `it.prop`, the `arbitrary` options bag, and the fix for each generator trap. Load when: writing or debugging a property test.
- [testclock.md](./references/testclock.md) — the hang, `it.live` for real I/O, the epoch start, and driving the clock. Load when: the code under test sleeps, retries, times out, polls or reads the time, or a test hangs for exactly the timeout.
- [test-console.md](./references/test-console.md) — why `Effect.log*` lands in `TestConsole`, and the immune emit paths. Load when: asserting on console or log output, or a "no output" test passes too easily.
- [mutation-testing.md](./references/mutation-testing.md) — the mutate-the-edges discipline, sweeping many mutants, the unfalsifiable rule, firing controls, reading a run, and `satisfies` exhaustiveness. Load when: claiming a suite proves a property, or a search came back empty.
- [structural-checks.md](./references/structural-checks.md) — the direction rule, the three false passes of an include check, comment strippers and their own test. Load when: asserting over source text, imports or exports.
- [running-the-suite.md](./references/running-the-suite.md) — zero-collection, running from the root, the setup-path `ERR_LOAD_URL`, stale `dist` after a skipped `globalSetup`, and probes that write no file. Load when: a run says `0/0`, its exit code disagrees with its summary, or a test ignores an edit to built output.
- [false-greens.md](./references/false-greens.md) — every false green above with its probe, plus fake `fetch` bodies, `assert.doesNotThrow`'s arguments, control characters, case folding, links to directories and credential walks. Load when: a green run surprises you, or before testing a `PubSub`, a timeout, a forked fiber, a spy or a concurrency window.
- [migrating-a-repo.md](./references/migrating-a-repo.md) — the conversion audit, the greps it is blind to, the collapse pre-flight, the hang class, `vi.mock`, console audits, installing from the same catalog as `effect`, and testing without `@effect/vitest`. Load when: converting a plain-Vitest repo, installing `@effect/vitest`, or it fails to load with a missing `effect/dist` module.
