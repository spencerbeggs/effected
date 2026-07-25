# False greens at test time — the worked cases

Loaded from `effect-v4-testing`. Each entry below is a green run that proves
nothing, with the probe or migration that exposed it. The main skill carries the
one-line rules; this file carries the evidence.

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
