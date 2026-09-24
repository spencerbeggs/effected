# False greens at test time — the worked cases

Loaded from `effect-v4-testing`. Each entry below is a green run that proves
nothing, with the probe or migration that exposed it. The main skill carries the
one-line rules; this file carries the evidence.

## A plain `it()` that RETURNS an Effect never runs

The cheapest false green in the catalogue, and the only one visible by grep:

```ts
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

let called = false;
const checkOne = (target: string) =>
  Effect.sync(() => {
    called = true;
    return { blocked: target === "broken" };
  });
void called;

// Reports GREEN without evaluating a single assertion.
it("blocked fires on a gate failure", () =>
  Effect.gen(function* () {
    const result = yield* checkOne("broken");
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

**`Tests: 0/0 passed` is the lie; the exit code is the honest half.** A run
that collects nothing exits **1** while printing a summary line that says
*passed*. With the `@vitest-agent/plugin` reporter:

| run (from the repo root) | Tests line | exit | which half lies |
| --- | --- | --- | --- |
| `--project <name>` | `143/143 passed` | 0 | neither |
| the same, plus `--coverage` | `143/143 passed`, then `Coverage thresholds skipped: partial run` | 0 | neither — the reporter skips global thresholds on a subset run |
| any filter matching nothing | `0/0 passed` | 1 | the **Tests line** |
| a test file that throws at load time | `✗ test suite failed to load`, naming the file and the throw | 1 | neither |

**So read BOTH, and treat disagreement as the alarm.** The Tests line lies on
every zero-match run; a reporter that enforced global coverage thresholds on a
subset run would make the exit code lie on a green run instead. An agent that
reads only `0/0 passed` reports green; an agent that reads only the exit code
cannot tell a zero-match run from a real failure.

### Run from the repo root

From inside `packages/lockfiles`, vitest does **not** load the root config. It
runs with the package directory as its root, so the repo's projects, setup
files and reporter are absent:

| invocation, cwd `packages/lockfiles` | result |
| --- | --- |
| `vitest run` | that package's 7 files under vitest's default reporter (`Tests 143 passed`), exit 0 — the repo's setup files and plugins never ran |
| `vitest run --project @effected/lockfiles` | `Startup Error: No projects matched the filter "@effected/lockfiles"`, exit 1 |
| `vitest run packages/lockfiles` | `No test files found, exiting with code 1` |
| `vitest run --config ../../vitest.config.ts --project @effected/walker` | a different package's project, green, exit 0 |

The last row is the escape hatch when you must stay in a package directory:
point `--config` at the root config explicitly. Otherwise run from the root.

**A positional filter is a substring, not a path.** It is matched against each
test file's path, so from the root `ckfiles` selects `@effected/lockfiles`'
143 tests: a partial word, neither a path nor a whole path segment. If
positional args were resolved as paths, or matched per segment, `ckfiles` would
match nothing. Reach for `--project <name>`, and give a positional filter a
substring that is actually present in the paths you want.

> A caveat is not evidence, and **neither is a more plausible mechanism**. When
> a tool upgrade or a config change moves the ground a measurement was taken
> on, re-run it. When you correct a mechanism, the correction needs its own
> discriminating input — one the old explanation and the new one answer
> *differently*. Rewriting an unmeasured word as a better-reasoned word leaves
> you exactly as unmeasured as before, while feeling like progress.

### A relative `globalSetup` path is a CONFIG defect, not a cwd rule

If a repo's config declares `globalSetup: ["vitest.setup.ts"]` — a bare relative
path — vitest resolves it against **cwd**, so a run from a package directory
that points `--config` at the root config looks for
`packages/<pkg>/vitest.setup.ts` and dies before collecting anything:

```text
Error: Failed to load url /…/packages/schemastore/vitest.setup.ts
  (resolved id: /…/packages/schemastore/vitest.setup.ts). Does the file exist?
Serialized Error: { code: 'ERR_LOAD_URL' }
```

The error misleads twice: it reads as a missing file you were meant to create,
and the tempting "fix" is to create a per-package setup file, which forks the
setup permanently. **The real fix is in the config**, one line:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: [fileURLToPath(new URL("vitest.setup.ts", import.meta.url))],
  },
});
```

The tell is an `ERR_LOAD_URL` naming a setup file inside a *package*
directory. Fix the config; do not add a cwd rule to work around it.

**Zero collected tests is never a pass**, whatever either signal says. The
producers to recognise:

- **A module-level throw** — most commonly the `Context.Service` TDZ (see
  `effect-v4-services-layers`). Typechecks clean, so nothing else warns you.
  The reporter prints `✗ test suite failed to load` and names the file; import
  the file directly and look at the throw before believing anything else the
  suite says.
- **A scratch test file left in a test tree** fails to load the same way and
  turns a whole package's run red. Never leave scratch `*.test.ts` files in a
  test tree — probe with `npx tsx` against a probe file INSIDE the package tree
  (see `effect-v4-source-lookup` for why `/tmp` cannot resolve `effect`).

**Do not "fix" a `0/0` by reaching for `--passWithNoTests`.** It is the one flag
that genuinely does turn these runs green: a zero-match run exits 1 by default
and **0** with the flag. It exists for a repo where an empty match is
legitimately expected; here it converts the last honest signal into a false one.

## `TestConsole.logLines` accumulates for the whole test

Cumulative, and **never drained by reading it**: in the test below, which logs
one line per run, the two reads return 1 line and then 2, and the second read
still contains the first run's output.

```ts
import { assert, it } from "@effect/vitest";
import { Console, Effect } from "effect";
import { TestConsole } from "effect/testing";

const runTool = (target: string) => Console.log(`ran ${target}`);

it.effect("BOTH assertions read the FIRST run's output — the second cannot fail", () =>
  Effect.gen(function* () {
    yield* runTool("a");
    const first = yield* TestConsole.logLines;
    assert.lengthOf(first, 1);
    assert.include(JSON.stringify(first), "ran a");
    yield* runTool("b");
    const second = yield* TestConsole.logLines;
    assert.lengthOf(second, 2); // the buffer grew; reading did not drain it
    assert.include(JSON.stringify(second), "ran a"); // still passes!
  }),
);
```

Any test that invokes a CLI (or any logging subject) **twice** asserts against a
growing buffer. Put each invocation in its own `it.effect`, or snapshot the
length before the second call and assert only on the new tail.

## A `layerNoop` stub records at effect CONSTRUCTION time

```ts
import { Effect, FileSystem } from "effect";

const run = (calls: Array<string>, suspend: boolean) => {
  const fsLayer = FileSystem.layerNoop({
    // WRONG (suspend: false) — pushes the moment the METHOD IS CALLED, before
    // the returned Effect ever runs. RIGHT (suspend: true) — the push only
    // happens if the returned Effect is actually executed.
    readFileString: suspend
      ? (p) =>
          Effect.suspend(() => {
            calls.push(p);
            return Effect.succeed("");
          })
      : (p) => {
          calls.push(p);
          return Effect.succeed("");
        },
  });
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const described = fs.readFileString("/never-executed"); // constructed, never yielded
    void described;
  }).pipe(Effect.provide(fsLayer));
};

const wrongCalls: Array<string> = [];
await Effect.runPromise(run(wrongCalls, false));
console.log("WRONG — described but never run:", wrongCalls);

const rightCalls: Array<string> = [];
await Effect.runPromise(run(rightCalls, true));
console.log("RIGHT — described but never run:", rightCalls);
```

Prints `WRONG — described but never run: [ '/never-executed' ]` then
`RIGHT — described but never run: []` — a service that builds its effects
once (at layer construction, or anywhere the effect is constructed but not
yielded) makes the eager recorder log `/never-executed` for a read that
never happened; the `Effect.suspend` version records nothing. **Wrap every
recorder in `Effect.suspend`** — otherwise a test asserting "the file was
read" passes against a code path that was only *described*, never run.

## `layerNoop` answers unimplemented members THREE different ways

**Not one way — and two blanket statements circulate, and both are wrong**:
"every unstubbed member fails typed `NotFound`" and "every unstubbed member
dies". `layerNoop` at `FileSystem.ts:765` is
`Layer.succeed(FileSystem)(makeNoop(fileSystem))`, and `makeNoop` (`:636`)
splits its members:

| members | behavior | absorbable by `Effect.catch`? |
| --- | --- | --- |
| `readFile`, `readFileString`, `readDirectory`, `stat`, `access`, `open`, `realPath`, `readLink`, `copy*`, `link`, `symlink`, `rename`, `truncate`, `utimes`, `glob`, `write*`, `sink`, `stream`, `watch` | typed `notFound(<method>, path)` — a `PlatformError` | **yes** |
| `exists` → `false` (`:657`), `remove` → `Effect.void` (`:696`) | silent success | n/a — never fails |
| `makeDirectory`, `makeTempDirectory{,Scoped}`, `makeTempFile{,Scoped}` (`:663`–`:676`) | `Effect.die("not implemented")` — a **defect** | **no** |

Three distinct false greens, one per row:

1. **Row one** is a false green for any package whose domain treats `NotFound`
   as "absent": a stub with `readFileString` overridden, code that later
   switches to `readFile` + decode, and the fixture goes **silently empty** —
   the test still passes because "no such file" is a legitimate answer in the
   domain.
2. **Row two** is worse, because nothing fails at all: a `remove` that never
   removed reports success, and a test asserting "the file is gone" agrees.
3. **Row three** is not a false green but a false *red* with a huge blast
   radius, and it is the row people mis-attribute. Production code that
   defensively absorbs a filesystem failure —
   `fs.makeDirectory(d).pipe(Effect.catch(() => Effect.void))` — **cannot**
   absorb a defect, so the first pipeline step that creates a directory kills
   every unrelated test in the suite at once. Twenty simultaneous failures read
   as "I broke the layer wiring", not "one new step calls `makeDirectory`".
   Note the discriminator: `readDirectory` is absorbable, `makeDirectory` is
   not — reading the first row and generalising is how this gets misdiagnosed.

**The mitigation is not a better `layerNoop` stub.** Per the repo's standing
rule, a test needing `FileSystem` provides `@effected/memfs`:
`MemoryFileSystem` implements all three rows honestly, so misbehaviour is
injected as a **fault handler** rather than encoded in a stub body that records
only what its author remembered. Keep `layerNoop` for the
one-trivially-stubbed-member case.

Companion fact, same tier: **`FileSystem.readFileString` strips a leading BOM.**
It is `impl.readFile(path)` piped through `new TextDecoder(encoding).decode(_)`
(`FileSystem.ts:508-519`, the decode itself at `:511`), and `TextDecoder`
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
const payload = new TextEncoder().encode(JSON.stringify({ hello: "world" }));

// WRONG — stringifying a Uint8Array produces a comma-joined byte list, which
// throws in JSON.parse. Inside a fake fetch that throw reads as a transport
// fault, which a resilient client retries.
const wrong = () => JSON.parse(String(payload));

try {
  wrong();
  console.log("WRONG: did not throw");
} catch (error) {
  console.log("WRONG threw:", error instanceof Error ? error.message : String(error));
}

// RIGHT — `Response` decodes whatever body shape the client sent.
const body = JSON.parse((await new Response(payload).text()) || "{}");
console.log("RIGHT:", body);
// For binary payloads: new Uint8Array(await new Response(init?.body).arrayBuffer())
```

Working examples: `packages/github-actions/__test__/results.ts:61-71` (JSON
over Twirp) and `BlobStore.test.ts:212` (bytes). The general rule: **a double
that mis-parses looks like the network being unreliable**, and every layer of
retry between the two makes the diagnosis worse. When a virtual-clock suite
times out in several places at once, suspect the double before the clock.

## A dead `Effect.timeout` guard never fires

An `Effect.timeout` guard fails with `Cause.TimeoutError` (`_tag`
`"TimeoutError"`, checked by `Cause.isTimeoutError`) — but only if the clock it
waits on actually reaches the deadline before vitest's own 5000ms default kills
the test. Which clock that is decides how the guard dies:

- **Under `it.effect` (the virtual `TestClock`), every guard is inert** — of any
  duration, `"10 millis"` included — until `TestClock.adjust` moves the clock
  past it. Nothing advances virtual time on its own.
- **Under a real clock** (`it.live`, or a `layer(..., { excludeTestServices: true })`
  block), a guard of 5 seconds or more loses the race to vitest's default.

Either way the failure reads `Test timed out in 5000ms.`, not the
`TimeoutError` the guard was written to produce, and nothing about the test's
source suggests why one message replaced the other.

WRONG — both are deliberately not run: each demonstrates the trap by hanging to
vitest's 5000ms default, which would make the gate that extracts and runs every
example in this file wait out two real timeouts on every pass.

```text
// Virtual clock: a 10-millisecond guard never fires, because nothing
// advances the TestClock.
it.effect("never gets to report its own timeout", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(Effect.timeout(Effect.never, "10 millis"));
    assert.isTrue(Cause.isTimeoutError(error)); // never reached
  }),
);

// Real clock: a 10-second guard loses to vitest's 5000ms default.
it.live("never gets to report its own timeout either", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(Effect.timeout(Effect.never, "10 seconds"));
    assert.isTrue(Cause.isTimeoutError(error)); // never reached
  }),
);
// Observed for both: "Test timed out in 5000ms." — not an assertion failure.
```

RIGHT — under `it.effect`, fork the guarded effect, drive the clock past the
deadline, then join. Under a real clock, keep the guard strictly under vitest's
timeout. Both assert the failure really is a `TimeoutError`, so a subject that
fails some other way turns the test red:

```ts
import { assert, it } from "@effect/vitest";
import { Cause, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

it.effect("reports its own TimeoutError once the TestClock passes the deadline", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.flip(Effect.timeout(Effect.never, "10 seconds")));
    yield* TestClock.adjust("10 seconds");
    const error = yield* Fiber.join(fiber);
    assert.isTrue(Cause.isTimeoutError(error));
  }),
);

it.live("reports its own TimeoutError when the guard is under vitest's timeout", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(Effect.timeout(Effect.never, "1 second"));
    assert.isTrue(Cause.isTimeoutError(error));
  }),
);
```

The virtual-clock test finishes in milliseconds despite its 10-second guard;
the live one takes one real second. Under a real clock, keep every internal
`Effect.timeout` guard strictly under whichever vitest timeout governs the
test — the 5000ms default, or the value passed as the test's own timeout
argument, whichever is smaller.

## A forked fiber's failure is not reported anywhere

A child forked with `Effect.forkScoped` and never joined runs to completion
— including a **failure** — with nothing about that failure reaching the
test. The test body finishes, the assertion it does make passes, and the
suite reports green.

```ts
import { assert, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock, TestConsole } from "effect/testing";

// The child fails; the test never notices. The control proves the log
// capture is live: a line logged at Error level does arrive.
it.effect("passes even though the forked child failed", () =>
  Effect.gen(function* () {
    yield* Effect.logError("control");
    yield* Effect.forkScoped(Effect.fail(new Error("child blew up")));
    yield* TestClock.adjust("10 millis"); // let the child run
    const logged = JSON.stringify(yield* TestConsole.logLines);
    assert.include(logged, "control"); // positive control: capture works
    assert.notInclude(logged, "child blew up"); // the failure was never logged
    assert.lengthOf(yield* TestConsole.errorLines, 0); // nor written to stderr
  }),
);

// RIGHT — join the fiber (or route its Exit into a Deferred the test awaits)
// so its Exit becomes something the test can assert on.
it.effect("Fiber.join surfaces the same failure", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkScoped(Effect.fail(new Error("child blew up")));
    const exit = yield* Effect.exit(Fiber.join(fiber));
    assert.isTrue(exit._tag === "Failure");
  }),
);
```

The first test is its own evidence: the control `logError` line reaches
`TestConsole.logLines`, and the child's failure appears in neither
`logLines` nor `errorLines`. Outside the test services it is the same — run
under `Effect.runPromise`, the program prints only the control line on stdout
and nothing on stderr. `References.UnhandledLogLevel` does not change this:
core reads it only in `Pool.ts:1028`. A test whose only assertions live in
code paths that never observe a forked child's outcome is exercising nothing
about that child. Join it, or route its `Exit` into a `Deferred` the test
explicitly awaits — never assume a green run means every fiber it started
behaved.

## Real-clock tests inside a `layer(...)` suite

`layer(...)`'s callback methods are `Vitest.MethodsNonLive` — there is no
`.live` inside it, only `.effect` (and its siblings), which install the
virtual `TestClock` by default the same as a bare `it.effect` would. For a
test inside such a suite that genuinely needs the real clock — timing a
subprocess, say — pass `excludeTestServices: true` to `layer(...)`: the
block's `it.effect` calls then run with the real `Clock` instead of the
virtual one.

```ts
import { assert, describe, layer } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";

describe("a suite needing the real clock", () => {
  layer(Layer.empty, { excludeTestServices: true })((it) => {
    it.effect(
      "a real sleep completes under a 3s guard — it would hang under a virtual clock",
      () => Effect.sleep("10 millis"),
      { timeout: 3000 },
    );

    it.effect("a second test in the same block also reads the real Clock", () =>
      Effect.gen(function* () {
        // The virtual TestClock starts at the epoch (0); a real clock reads
        // well past 1.7e12 milliseconds.
        const now = yield* DateTime.now;
        assert.isAbove(DateTime.toEpochMillis(now), 1.7e12);
      }),
    );
  });
});
```

Both tests pass, each in real time: the first because a real 10-millisecond
sleep completes, the second because the clock reads the present rather than
1970. Reaching for `it.live` inside a
`layer(...)` block is a type error, not a style choice — `excludeTestServices`
is the block-wide equivalent.

## Draining a `PubSub` under `it.effect`

Three sharp edges, all clock-adjacent:

- **`PubSub.takeAll` suspends on an empty subscription.** Its return type is
  `Effect<NonEmptyArray<A>>` (`PubSub.ts:1198`) — that *is*
  the proof. Under the virtual clock it hangs to the vitest timeout. Use
  `PubSub.takeUpTo(sub, n)` (`PubSub.ts:1278`), which returns what is there.
- **`PubSub.subscribe` requires a `Scope`** (`PubSub.ts:1083`) and there is no
  `it.scoped` — but you do **not** need one. `it.effect` already runs its body
  through `Effect.scoped`:
  `makeTester<Scope.Scope>(flow(Effect.scoped, Effect.provide(TestEnv)), it)`
  (`@effect/vitest` `internal/internal.ts:382`), and its type is
  `Tester<R | Scope.Scope>` (`index.ts:113`), so a `Scope` requirement is
  satisfied by the runner. An explicit `Effect.scoped` in the pipeline is
  harmless — it just closes the scope earlier, before the test ends — but it is
  belt-and-braces, not a requirement.
- **`Effect.fork` does not exist** — it is `forkChild` (`Effect.ts:8578`) /
  `forkIn` (`:8621`) / `forkScoped` (`:8664`) / `forkDetach` (`:8704`). And
  `Stream.fromQueue` takes a `Queue.Dequeue`
  (`Stream.ts:1139`), so it rejects a `Subscription`.

The clock-free drain: subscribe, run the operation, then `takeUpTo`.

```ts
import { assert, it } from "@effect/vitest";
import { Context, Effect, Layer, PubSub } from "effect";

interface ConfigEvent {
  readonly _tag: "Discovered" | "Loaded"
}

class ConfigEvents extends Context.Service<
  ConfigEvents,
  { readonly events: PubSub.PubSub<ConfigEvent> }
>()("ConfigEvents") {
  static readonly layer = Layer.effect(
    ConfigEvents,
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<ConfigEvent>();
      return { events };
    }),
  );
}

const runTheOperation = Effect.gen(function* () {
  const svc = yield* ConfigEvents;
  yield* PubSub.publish(svc.events, { _tag: "Discovered" } as const);
  yield* PubSub.publish(svc.events, { _tag: "Loaded" } as const);
});

const layers = ConfigEvents.layer;

it.effect("emits the events", () =>
  Effect.gen(function* () {
    const svc = yield* ConfigEvents;
    const sub = yield* PubSub.subscribe(svc.events);
    yield* runTheOperation;
    const events = yield* PubSub.takeUpTo(sub, Number.MAX_SAFE_INTEGER);
    assert.deepStrictEqual(events.map((e) => e._tag), ["Discovered", "Loaded"]);
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
(`packages/github-actions/__test__/ActionEnvironment.test.ts:277-303`):

```ts
import { assert, it } from "@effect/vitest";
import { Context, Effect, Latch } from "effect";

// A fiber-local implementation: providing a service only affects the fiber
// (and its descendants) the provide wraps — two concurrent branches of one
// Effect.all never see each other's provide.
const CurrentVar = Context.Reference<string | undefined>("CurrentVar", { defaultValue: () => undefined });
const env = {
  withEnv: <A, E, R>(vars: { readonly VAR: string }, effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, CurrentVar, vars.VAR),
  get: (_name: "VAR") => CurrentVar,
};

it.effect("one fiber's override does not leak into a concurrent fiber's read", () =>
  Effect.gen(function* () {
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
  }),
);
```

Non-vacuity, confirmed directly: swapping `env` for a shared global save/restore
implementation (the deliberately-wrong shape this section warns about) makes
this exact test fail with `expected 'right' to equal 'left'` — the
discriminator genuinely distinguishes the two implementations, not merely
runs.

**Latches, not sleeps.** `it.effect` installs a virtual `TestClock`, so an
`Effect.sleep` used to stage an interleaving hangs to the vitest timeout rather
than interleaving. Three-way variants scale the same way — one latch per
ordering constraint, each named for the constraint it enforces
(`ActionLogger.test.ts:268-270` runs three).

## A spy restored in `try`/`finally` inside `Effect.gen` LEAKS

A failing assertion inside `Effect.gen` leaves through the **error channel**,
not by throwing, so a `finally` written around the generator body does not run
the way the shape suggests. A `vi.spyOn` on a process global that survives its
own test then poisons every later one: **false reds** in the neighbours, and —
worse — **false greens** afterwards, because the surviving stub can also make a
test pass that should have failed. The control that proves a guard is not
simply refusing everything is exactly the test a leaked spy silently subverts.

Acquire and release the spy instead, so the runtime owns the restore on every
exit path (`packages/github-actions/__test__/DetachedProcess.test.ts:55-63`):

```ts
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

const withKillSpy = <A, E>(impl: () => true, use: (calls: ReadonlyArray<ReadonlyArray<unknown>>) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => vi.spyOn(process, "kill").mockImplementation(impl as never)),
    (spy) => use(spy.mock.calls),
    (spy) => Effect.sync(() => spy.mockRestore()),
  );

it.effect("the spy is restored even though acquireUseRelease's release always runs", () =>
  Effect.gen(function* () {
    const wasSpiedDuring = yield* withKillSpy(
      () => true,
      () => Effect.sync(() => vi.isMockFunction(process.kill)),
    );
    assert.isTrue(wasSpiedDuring);
    assert.isFalse(vi.isMockFunction(process.kill));
  }),
);
```

## `process.exitCode` set by a test fails the vitest PROCESS

Anything that sets `process.exitCode` — a CLI entry point, an action runner —
leaves it set for the rest of the run, and vitest exits with it. The result is
a **green suite that fails**: every test reports passing and the process exits
nonzero, which CI reads as a failure with no failing test to point at.

Snapshot and restore it in a `finally` around any test that exercises such
code, alongside the console spy and any env mutation
(`packages/github-actions/__test__/Action.test.ts:44-54`):

```ts
import { assert, it } from "@effect/vitest";

const run = async (lines: ReadonlyArray<string>): Promise<void> => {
  if (lines.includes("fail")) process.exitCode = 1;
};

it("restores process.exitCode to its previous value, not to 0", async () => {
  process.exitCode = 3; // simulate an earlier test that legitimately set it
  const previousExit = process.exitCode;
  try {
    await run(["fail"]);
    assert.strictEqual(process.exitCode, 1);
  } finally {
    process.exitCode = previousExit;
  }
  assert.strictEqual(process.exitCode, 3);
  process.exitCode = 0; // do not leak this probe's own simulated value
});
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
deliberately lets go of the child (`packages/github-actions/src/DetachedProcess.ts:320-326`);
the durable lesson is the reading habit. **A run with `unhandledErrors`
non-empty is not a clean run**, whatever the Tests line says — treat it exactly
like `0 tests passed`: a signal the reporter is telling you something the pass
count structurally cannot.

## Timing gates under coverage lie

v8 coverage instrumentation slows instrumented code by a workload-dependent
factor, and parser-heavy hot loops pay the most. A raw-millisecond performance
assertion is therefore meaningless under coverage: it fails in CI for reasons
unrelated to the code. The house pattern is **calibrated budgets** — time a small calibration
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
`assert.strictEqual(key(dep), "lodash\0dependencies")`. One direct
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
