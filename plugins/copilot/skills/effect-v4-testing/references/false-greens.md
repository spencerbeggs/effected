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

**`Tests: 0/0 passed` is the lie; the exit code is the honest half — the exact
reverse of what this file used to say.** Every zero-collection route exits **1**
while printing a summary line that says *passed*. The old text claimed they exit
0 and told you to read the Tests line instead, which pointed readers at the only
signal that still lies.

Measured 2026-09-05, `vitest@4.1.11` + the `@vitest-agent/plugin` reporter:

| run | Tests line | exit | which half lies |
| --- | --- | --- | --- |
| `--project <name>`, from **anywhere** | `143/143 passed` | 0 | neither |
| the same, plus `--coverage` (or on CI) | `143/143 passed` | **1** | the **exit code** — global thresholds measure the whole repo, so any subset run fails them by construction |
| a **path** filter with cwd not the repo root | `0/0 passed` | 1 | the **Tests line** |
| any filter matching nothing | `0/0 passed` | 1 | the **Tests line** |
| a module-level throw in a collected file | `0/0 passed` | 1 | the **Tests line** |
| one test file with a load-time error | `✗ test suite failed to load` | 1 | neither — the reporter names the file |

**So read BOTH, and treat disagreement as the alarm.** Neither signal is
trustworthy alone, and they fail in *complementary* situations: the exit code
lies on a passing subset run under coverage, the Tests line lies on every
zero-collection run. "Read the Tests line, not the exit code" was written when
global thresholds were enforced on every run, so the exit code carried no
information at all; scoping thresholds to CI and explicit `--coverage` gave it
its meaning back. The rule outlived the condition that justified it — and an
agent still following it reads `0/0 passed`, ignores the `1`, and reports green.

### cwd: which invocations actually depend on it

Vitest **walks up from cwd to find the config** and anchors its root there, so
far less is cwd-sensitive than folklore claims. Measured from inside
`packages/lockfiles`:

| invocation | result |
| --- | --- |
| `vitest run` | the **whole repo** suite — `12298/12298`, exit 0. Correct, just not what you meant. |
| `vitest run --project @effected/lockfiles` | `143/143`, exit 0 |
| `vitest run --project @effected/walker` | `75/75`, exit 0 — a **different** package's project, from this one's directory |
| `vitest run packages/lockfiles` | `0/0 passed`, exit 1 |

**`--project <name>` is the invocation to reach for: it resolves against the
config root and works from any directory.** The third row is the one that
settles it — a project filter naming a package you are *not* standing in still
runs, so this is genuine config-root anchoring, not a coincidence of matching
the cwd.

**Only a positional filter is cwd-sensitive — and not as a path.** A positional
arg is matched as a **substring of each test file's path as rendered from the
cwd**, which is a different mechanism from path resolution and predicts
different results:

| positional filter | cwd | result |
| --- | --- | --- |
| `packages/lockfiles` | `packages/lockfiles` | `0/0` — that substring appears in no path rendered from here |
| `__test__` | `packages/lockfiles` | the **whole repo**, `12298/12298`, exit 0 — that substring appears in every project's paths |
| `ckfiles` | repo root | `143/143`, exit 0 — a partial word, neither a path nor a whole path segment |
| `lockfiles` | `packages/lockfiles` | `0/0`, exit 1 — the same string that matches from the root |

Each row kills a different plausible explanation, which is why all four are
here:

- If positional args were resolved as cwd-relative **paths**, `__test__` would
  have selected this package's own tests. It selected all of them.
- If they were matched per path **segment** or as a prefix, `ckfiles` would
  match nothing. It selected lockfiles' 143 — so the match is a plain substring.
- The last two rows are the same needle against the same tree, differing only in
  cwd, and they disagree — which is what pins the match to the path **as
  rendered from the cwd**: `packages/lockfiles/__test__/…` from the root,
  bare `__test__/…` from inside.

So "cwd-relative" gets the right advice for the wrong reason. Reach for
`--project <name>`, and give a positional filter a substring that is actually
present in the paths you want — which from the repo root is what
`packages/<pkg>` is.

> **This section has now been wrong twice, in two different ways. Recognise
> both — the second is the subtler and the more tempting.**
>
> 1. **Generalising across untested cases.** "A path filter needs the repo root"
>    was extrapolated into "vitest must run from the repo root" — true of the one
>    form that had been measured, false of `--project`, which nobody ran.
> 2. **Substituting a better theory for a measurement.** The correction to that
>    replaced "root-relative" with "cwd-relative". Better reasoning, genuinely
>    closer, still never run — and it predicts the wrong answer for `__test__`.
>
> A caveat is not evidence, and **neither is a more plausible mechanism**. When a
> fix or a config change moves the ground a measurement was taken on, re-run it;
> and when you correct a mechanism, the correction needs its own discriminating
> input — one the old explanation and the new one answer *differently*. Rewriting
> an unmeasured word as a better-reasoned word leaves you exactly as unmeasured
> as before, while feeling like progress.

### A relative `globalSetup` path is a CONFIG defect, not a cwd rule

If a repo's config declares `globalSetup: ["vitest.setup.ts"]` — a bare relative
path — vitest resolves it against **cwd**, so running from `packages/<pkg>` looks
for `packages/<pkg>/vitest.setup.ts` and dies before collecting anything:

```text
Error: Failed to load url /…/packages/schemastore/vitest.setup.ts
  (resolved id: /…/packages/schemastore/vitest.setup.ts). Does the file exist?
Serialized Error: { code: 'ERR_LOAD_URL' }
```

The error misleads twice: it reads as a missing file you were meant to create,
and the tempting "fix" is to create a per-package setup file, which forks the
setup permanently. **The real fix is in the config**, one line:

```ts
globalSetup: [fileURLToPath(new URL("vitest.setup.ts", import.meta.url))]
```

This repo shipped that fix (effected#455), so the `ERR_LOAD_URL` symptom is
**history here** and a bare run from inside a package now succeeds. Expect it in
any repo that has not — the tell is an `ERR_LOAD_URL` naming a setup file inside
a *package* directory. Fix the config; do not add a cwd rule to work around it.

**Zero collected tests is never a pass**, whatever either signal says. The
remaining producers:

- **A module-level throw** — most commonly the `Context.Service` TDZ (see
  `effect-v4-services-layers`). Typechecks clean, so nothing else warns you.
  Import the file directly and look at the throw before believing anything else
  the suite says.
- **One broken file zeroes the whole package.** A single test file with a
  load-time error — even a scratch/debug file — takes hundreds of sibling tests
  with it (observed 2026-07-18: a 400-test package zeroed by one bad scratch
  file). The reporter has since improved: it now prints
  `✗ test suite failed to load` and names the module, so this producer no longer
  hides. Still never leave scratch `*.test.ts` files in a test tree — probe with
  `npx tsx` against a probe file INSIDE the package tree (see
  `effect-v4-source-lookup` for why `/tmp` cannot resolve `effect`).

**Do not "fix" a `0/0` by reaching for `--passWithNoTests`.** It is the one flag
that genuinely does turn these runs green: measured, a zero-match run exits 1 by
default and **0** with the flag. It exists for a repo where an empty match is
legitimately expected; here it converts the last honest signal into a false one.

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

## `layerNoop` answers unimplemented members THREE different ways

**Not one way — and the two blanket statements that circulate are both wrong**:
"every unstubbed member fails typed `NotFound`" (what this section used to say)
and "every unstubbed member dies" (the opposite over-correction). Probed at
`effect@4.0.0-rc.112`; `layerNoop` at `FileSystem.ts:954` is
`Layer.succeed(FileSystem)(makeNoop(fileSystem))`, and `makeNoop` (`:825`)
splits its members:

| members | behavior | absorbable by `Effect.catch`? |
| --- | --- | --- |
| `readFile`, `readFileString`, `readDirectory`, `stat`, `access`, `open`, `realPath`, `readLink`, `copy*`, `link`, `symlink`, `rename`, `truncate`, `utimes`, `glob`, `write*`, `sink`, `stream`, `watch` | typed `notFound(<method>, path)` — a `PlatformError` (`:764`) | **yes** |
| `exists` → `false` (`:844`), `remove` → `Effect.void` (`:885`) | silent success | n/a — never fails |
| `makeDirectory`, `makeTempDirectory{,Scoped}`, `makeTempFile{,Scoped}` (`:850`–`:866`) | `Effect.die("not implemented")` — a **defect** | **no** |

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

Working examples: `packages/github-actions/__test__/results.ts:61-71` (JSON
over Twirp) and `BlobStore.test.ts:212` (bytes). The general rule: **a double
that mis-parses looks like the network being unreliable**, and every layer of
retry between the two makes the diagnosis worse. When a virtual-clock suite
times out in several places at once, suspect the double before the clock.

## Draining a `PubSub` under `it.effect`

Three sharp edges, all clock-adjacent:

- **`PubSub.takeAll` suspends on an empty subscription.** Its return type is
  `Effect<NonEmptyArray<A>>` (`PubSub.ts:1192`, checked at rc.109) — that *is*
  the proof. Under the virtual clock it hangs to the vitest timeout. Use
  `PubSub.takeUpTo(sub, n)` (`PubSub.ts:1270`), which returns what is there.
- **`PubSub.subscribe` requires a `Scope`** (`PubSub.ts:1077`) and there is no
  `it.scoped` — but you do **not** need one. `it.effect` already runs its body
  through `Effect.scoped`: at rc.109 it is
  `makeTester<Scope.Scope>(flow(Effect.scoped, Effect.provide(TestEnv)), it)`
  (`@effect/vitest` `internal/internal.ts:356`), and its type is
  `Tester<R | Scope.Scope>` (`index.ts:101`), so a `Scope` requirement is
  satisfied by the runner. An explicit `Effect.scoped` in the pipeline is
  harmless — it just closes the scope earlier, before the test ends — but it is
  belt-and-braces, not a requirement.
- **`Effect.fork` does not exist** — it is `forkChild` (`Effect.ts:8492`) /
  `forkIn` (`:8535`) / `forkScoped` (`:8578`) / `forkDetach` (`:8618`), still
  the complete set at rc.109. And `Stream.fromQueue` takes a `Queue.Dequeue`
  (`Stream.ts:1132`), so it rejects a `Subscription`.

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
(`packages/github-actions/__test__/ActionEnvironment.test.ts:277-303`):

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
(`packages/github-actions/__test__/Action.test.ts:44-54`):

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
deliberately lets go of the child (`packages/github-actions/src/DetachedProcess.ts:309-315`);
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
