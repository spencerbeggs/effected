# False greens at test time — the worked cases

Loaded from `effect-v4-testing`. Each entry below is a green run that proves
nothing, with the probe or migration that exposed it. The main skill carries the
one-line rules; this file carries the evidence.

## A plain `it()` that RETURNS an Effect never runs

The cheapest false green in the catalogue, and the only one visible by grep:

```ts
// Reports GREEN without evaluating a single assertion.
it("blocked fires on a gate failure", () =>
  Effect.gen(function* () {
    const result = yield* SchemaPipeline.checkOne(brokenTarget);
    assert.isTrue(result.blocked);
  }),
);
```

An Effect is a description. Vitest receives a value that is not a promise,
does nothing with it, and passes. `Effect.gen`'s body never executes, so
`checkOne` is never called and `assert.isTrue` is never reached. Nothing warns
at any layer — not the type checker (the callback's return type is unconstrained),
not the runtime, not the reporter.

It is the inverse of the laundering mistake the main skill already bans:

| shape | runs? | symptom |
| --- | --- | --- |
| `it(..., () => Effect.runPromise(p))` | yes | correct pass/fail, execution laundered |
| `it(..., () => p)` | **no** | always green, zero assertions evaluated |

Only the first one *looks* wrong, which is why the second survives review.
The fix in both directions is `it.effect`.

**What it cost.** This shipped in `@effected/schemastore`. The vacuous test was
the one pinning a reachability finding a downstream consumer had reported as an
observation; when the consumer was told "our tests prove this," the cited test
had never run. That is the real hazard — a false green is not only a missed
regression, it is admissible-looking evidence in a conversation.

**Detect it structurally.** An `it(` whose callback returns an `Effect.*`
expression without `runPromise`/`runSync` is always a bug, so it is a
one-rule source-text check (see
[structural-checks.md](./structural-checks.md)) rather than something to
re-notice in review.

## `0 tests passed` is a FAILED run, not an empty one

A module-level throw — most commonly the `Context.Service` TDZ (see
`effect-v4-services-layers`) — is swallowed by the agent reporter, which prints
`0 tests passed` and **exits 0**. It typechecks clean, so nothing else warns
you. **Zero collected tests is never a pass.** Read the Tests line, not the exit
code; import the file directly and look at the throw before believing anything
else the suite says.

**One broken file zeroes the whole package.** A single test file with a
load-time error — even a scratch/debug file — silently zeroes the entire package
run: `Tests: 0/0 passed`, exit 0, hundreds of sibling tests gone. The
`--reporter=json` output is equally empty (`numTotalTests: 0`, zero suites), so
the reporter offers no cause. The tell is a package you KNOW has a nonzero suite
reporting `0/0`; the remedy is bisecting for the file that fails to load
(observed 2026-07-18: a 400-test package zeroed by one bad scratch file). Never
leave scratch `*.test.ts` files in a test tree — probe with `npx tsx` against a
probe file INSIDE the package tree (see `effect-v4-source-lookup` for why `/tmp`
cannot resolve `effect`).

**The other producer: a project filter run from the wrong directory.** `vitest
run --project @effected/walker` invoked from **inside** the package directory
matches no project — the filter resolves **root-relative** — and prints
`Tests: 0/0 passed (0ms)`, exit 0, looking exactly like a clean run. Run
project-filtered vitest from the repo root, always. You land here when the
`vitest-agent` MCP `run_tests` tool drops mid-session and you fall back to a raw
`vitest` invocation; an MCP dropout is the cue to be *more* careful about cwd.

**The tell is the compound command**, because `cd` is what makes it look
reasonable:

```bash
cd packages/github-actions && pnpm exec tsc --noEmit && pnpm exec vitest run --project @effected/github-actions
```

That line poisons only its **last** clause. The typecheck is genuinely
package-relative and genuinely passes; the vitest half matches no project and
reports `0/0`, exit 0 — so the whole chain exits 0 and reads as "types clean,
tests green". Whenever you catch yourself writing `cd <pkg> && … && vitest`,
split it: typecheck from the package, run tests from the root.

## `TestConsole.logLines` accumulates for the whole test

Cumulative, and **never drained by reading it**. Probed on beta.94: two reads
across one test returned 2 lines then 4, and the second read still contained the
first run's output.

```ts
// BOTH assertions read the FIRST run's output. The second cannot fail.
yield* runCli(["--target", "a"]);
assert.include(JSON.stringify(yield* TestConsole.logLines), "a");
yield* runCli(["--target", "b"]);
assert.include(JSON.stringify(yield* TestConsole.logLines), "a"); // still passes!
```

Any test that invokes a CLI (or any logging subject) **twice** asserts against a
growing buffer. Put each invocation in its own `it.effect`, or snapshot the
length before the second call and assert only on the new tail.

## A `layerNoop` stub records at effect CONSTRUCTION time

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

Probed on beta.94: a service that builds its effects once (at layer
construction, or anywhere the effect is constructed but not yielded) made the
eager recorder log `/never-executed` for a read that never happened; the
`Effect.suspend` version recorded nothing. **Wrap every recorder in
`Effect.suspend`** — otherwise a test asserting "the file was read" passes
against a code path that was only *described*, never run.

## `layerNoop` answers every unimplemented member with a typed `NotFound`

`FileSystem.layerNoop(partial)` wraps `makeNoop`, and every member you do not
override fails with `notFound(<method>, path)` — a **typed `PlatformError`**,
not a defect (`FileSystem.ts:764` for the `notFound` constructor, `:825` for
`makeNoop`, `:873` / `:876` for the `readFile` / `readFileString` members;
`layerNoop` at `:954` is `Layer.succeed(FileSystem)(makeNoop(fileSystem))`).
Line numbers re-checked at beta.107.

That is a false green for any package whose domain treats `NotFound` as
"absent": a stub with `readFileString` overridden, code that later switches to
`readFile` + decode, and the fixture goes **silently empty** — the test still
passes because "no such file" is a legitimate answer in the domain. The
mitigation is to override every read method the code could plausibly reach, and
to make at least one test assert the *contents* the fixture is supposed to
supply, not merely that the call succeeded.

Companion fact, same tier: **`FileSystem.readFileString` strips a leading BOM.**
It is `impl.readFile(path)` piped through `new TextDecoder(encoding).decode(_)`
(`FileSystem.ts:701-712`, the decode itself at `:704`), and `TextDecoder`
defaults to `ignoreBOM: false`,
which consumes the mark. "Read the file as a string" therefore looks lossless
and is not. A round-trip test that reads with `readFileString` and writes back
cannot see the BOM it just dropped; read bytes and decode with
`new TextDecoder("utf-8", { ignoreBOM: true })` where the mark is part of the
contract.

## A fake `fetch` must DECODE the request body, never stringify it

A test double for `fetch` that records `String(init.body)` is wrong whenever
the client sends bytes: a `Uint8Array` stringifies to `123,34,…`, which throws
in `JSON.parse`. Inside a fake `fetch` that throw surfaces as a **transport
fault**, which a resilient client **retries**, which hangs the virtual clock.
One misread fixture presented as *ten unrelated timeouts* in three suites —
none of them near the actual mistake.

```ts
// RIGHT — `Response` decodes whatever body shape the client sent.
const body = JSON.parse((await new Response(init?.body ?? "{}").text()) || "{}");
// For binary payloads: new Uint8Array(await new Response(init?.body).arrayBuffer())
```

Working examples: `packages/github-actions/__test__/results.ts:63-70` (JSON
over Twirp) and `BlobStore.test.ts:212` (bytes). The general rule: **a double
that mis-parses looks like the network being unreliable**, and every layer of
retry between the two makes the diagnosis worse. When a virtual-clock suite
times out in several places at once, suspect the double before the clock.

## Draining a `PubSub` under `it.effect`

Three sharp edges, all clock-adjacent:

- **`PubSub.takeAll` suspends on an empty subscription.** Its return type is
  `Effect<NonEmptyArray<A>>` — that *is* the proof. Under the virtual clock it
  hangs to the vitest timeout. Use `PubSub.takeUpTo(sub, n)`, which returns what
  is there.
- **`PubSub.subscribe` requires a `Scope`**, and there is no `it.scoped`. Pipe
  `Effect.scoped` **before** `Effect.provide`.
- **`Effect.fork` does not exist** — it is `forkChild` / `forkScoped` / `forkIn`
  / `forkDetach`. And `Stream.fromQueue` rejects a `Subscription`.

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

## One latch is not enough to prove a concurrency leak

A test that two fibers do not see each other's overrides needs **two** latches,
and the order of the awaits *is* the test. A single-latch interleaving PASSED
against a deliberately-wrong implementation that saved and restored a shared
global, because save/restore is **LIFO-correct whenever the overrides nest**:
if the inner override restores before the outer fiber reads, the wrong
implementation and the right one are indistinguishable. The near miss was the
`ActionEnvironment.withEnv` work, where the passing single-latch test was the
only evidence for "parallel-safe".

The discriminating shape forces **one fiber to read while the other's override
is applied and unrestored** — which only a fiber-local implementation survives
(`packages/github-actions/__test__/ActionEnvironment.test.ts:236-279`):

```ts
const rightApplied = yield* Latch.make();
const leftDone = yield* Latch.make();
const [left, right] = yield* Effect.all(
  [
    env.withEnv({ VAR: "left" }, Effect.gen(function* () {
      yield* rightApplied.await;              // right's override is LIVE here
      const seen = yield* env.get("VAR");
      yield* leftDone.open;
      return seen;
    })),
    env.withEnv({ VAR: "right" }, Effect.gen(function* () {
      const seen = yield* env.get("VAR");
      yield* rightApplied.open;
      yield* leftDone.await;                  // held open across left's read
      return seen;
    })),
  ],
  { concurrency: 2 },
);
assert.strictEqual(left, "left");
assert.strictEqual(right, "right");
```

**Latches, not sleeps.** `it.effect` installs a virtual `TestClock`, so an
`Effect.sleep` used to stage an interleaving hangs to the vitest timeout rather
than interleaving. Three-way variants scale the same way — one latch per
ordering constraint, each named for the constraint it enforces
(`ActionLogger.test.ts:203` runs three).

## A spy restored in `try`/`finally` inside `Effect.gen` LEAKS

A failing assertion inside `Effect.gen` leaves through the **error channel**,
not by throwing, so a `finally` written around the generator body does not run
the way the shape suggests. A `vi.spyOn` on a process global that survives its
own test then poisons every later one: **false reds** in the neighbours, and —
worse — **false greens** afterwards, because the surviving stub can also make a
test pass that should have failed. The control that proves a guard is not
simply refusing everything is exactly the test a leaked spy silently subverts.

Acquire and release the spy instead, so the runtime owns the restore on every
exit path (`packages/github-actions/__test__/DetachedProcess.test.ts:33-51`):

```ts
const withKillSpy = <A, E>(impl: () => true, use: (calls: ReadonlyArray<ReadonlyArray<unknown>>) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => vi.spyOn(process, "kill").mockImplementation(impl as never)),
    (spy) => use(spy.mock.calls),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );
```

## `process.exitCode` set by a test fails the vitest PROCESS

Anything that sets `process.exitCode` — a CLI entry point, an action runner —
leaves it set for the rest of the run, and vitest exits with it. The result is
a **green suite that fails**: every test reports passing and the process exits
nonzero, which CI reads as a failure with no failing test to point at.

Snapshot and restore it in a `finally` around any test that exercises such
code, alongside the console spy and any env mutation
(`packages/github-actions/__test__/Action.test.ts:31-52`):

```ts
const previousExit = process.exitCode;
try { await run(lines); } finally { process.exitCode = previousExit; }
```

Restore to the **previous value**, not to `0` or `undefined` — an earlier test
may legitimately have set it, and clobbering that hides a real failure.

## Read the reporter's `unhandledErrors` field

A test can fail *correctly*, be reported *correctly*, and still leave a live
defect that no assertion can see — because the throw happens **asynchronously,
after** the reporting. A Node `ChildProcess` with no `error` listener re-emits
the event as an uncaught exception; in the `@effected/github-actions`
detached-spawn work that meant a missing binary would take down the **action**
rather than failing the call, while the suite showed **15 green tests** and a
correctly-reported failure for the very case that produced it. Only the
reporter's `unhandledErrors` field showed it.

The fix there was a documented no-op listener at the point the parent
deliberately lets go of the child (`packages/github-actions/src/DetachedProcess.ts:196-204`);
the durable lesson is the reading habit. **A run with `unhandledErrors`
non-empty is not a clean run**, whatever the Tests line says — treat it exactly
like `0 tests passed`: a signal the reporter is telling you something the pass
count structurally cannot.

## Timing gates under coverage lie by an order of magnitude

v8 coverage instrumentation cost a measured **~18×** on parser-heavy code in
this repo (63ms clean vs 1126ms instrumented for the same parse; a 4.9s
pathological case took 114s). A raw-millisecond performance assertion is
therefore meaningless under coverage: it fails in CI for reasons unrelated to
the code. The house pattern is **calibrated budgets** — time a small calibration
input through the same code path, divide by its clean-run baseline, and scale
every budget by that factor. A genuine algorithmic regression still fails
(quadratic outruns any constant factor), while instrumentation and slow hardware
scale both sides together.

Related: `it.effect` takes a Vitest timeout as its third argument. Any real-time
elapsed assertion above Vitest's default 5000ms is **dead code** without it —
Vitest aborts before the assertion runs, and the failure reads "Test timed out
in 5000ms", not your bound. A wall-clock ceiling and the test's timeout must be
calibrated together; whichever is lower is the effective bound (the toml scale
suite shipped a 30s `assert.isBelow` under the 5s default and CI red-flagged the
*same* test twice before the timeout argument was added).

## A helper used on BOTH sides of a comparison is not tested by that comparison

A broken helper still agrees with itself. If every test that touches a helper
feeds its output into both sides of an equality, the helper is unverified no
matter how many tests are green — the suite is structurally incapable of
failing in response to a change in it.

The real case: a lockfile comparator built a composite map key,
`` `${dep.name}\0${dep.depType}` ``, and used it symmetrically for the "before"
and the "after" side. A one-character change to that separator — the exact edit
under review — could not have been caught by any of the suite's 546 tests,
because both sides would compute the same wrong key and compare equal. The same
shape covers a normalizer applied to expected and actual, a serializer used to
build the fixture *and* to render the result, and a sort comparator used on both
lists before `deepStrictEqual`.

The tell is structural, and cheap to check once you know to look: **does any
test observe the helper's output directly, or only comparisons of it against
itself?** If only the latter, add one test that asserts the literal output —
`assert.strictEqual(key(dep), "lodash dependencies")`. One direct
assertion converts the whole symmetric suite from decoration into a gate.

When the value under test is an escape sequence or any character you cannot see
in a diff, assert it a second way that cannot share the mistake — an
equivalence probe (`` `x\0y` === `x${String.fromCharCode(0)}y` ``), a byte
comparison, or a codepoint assertion. Comparing an invisible character against a
copy of itself is the symmetric trap one level down.

The general form, worth applying to any green signal: **ask what specific
change would have turned this red. If the answer is "nothing", the signal is
decoration.**

## A big green count is not evidence for a surface the suite never calls

Before trusting a suite as the regression gate for a change, confirm the suite
actually **calls the surface you changed**. In `@effected/yaml` the 1226
conformance fixtures drive an internal engine facade
(`__test__/e2e/support/engine.ts`) and never call `Yaml.parse`, so a green 1226
said nothing about a change to `Yaml.parse`'s derivation — the count measured
the engine, not the public function. The fix: build a **differential** against
the prior implementation across the same corpus, and — the step that makes it
non-vacuous — prove the differential can fail (inject a divergence, watch it
flag) before trusting a green. A suite that cannot exercise your change cannot
fail in response to it, which is the same defect as a mutant that cannot be
pinned, one level up.
