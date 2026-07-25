# Migrating a repo to `@effect/vitest`

Loaded from `effect-v4-testing`. Everything here was learned converting all 13
projects of one repo — 228 test files, 4041 tests — from plain Vitest to
`@effect/vitest` at `effect@4.0.0-beta.101` / `@effect/vitest@4.0.0-beta.101` /
`vitest@4.1.10`, ending at exact baseline parity.

A repo whose tests are plain Vitest is **not** "nothing to migrate on the
testing axis": `@effect/vitest` re-exports Vitest, so it drops in, plain `it()`
tests keep working, and only the Effect-bearing ones move to `it.effect`.

## The audit validates preservation, not well-formedness

The natural audit for a bulk conversion — assertion counts, a sorted
assertion-text diff, test-declaration counts — proves that **assertions
survived**. It says nothing about whether the result is well-formed code that
executes. Three defect classes, all produced by scripted transforms, all
invisible to that audit:

1. **`const r = yield* Effect.runPromise(X)` collapsing to `const r = X`** — an
   Effect assigned and never run, with assertions then reading fields off an
   Effect object. 20 sites in one conversion. Caught only by Biome's
   `lint/correctness/useYield`.
2. **`yield* import(...)`** — a Promise yielded inside `Effect.gen`. Caught only
   by an actual run.
3. **`yield*` landing inside a plain `async function` helper *outside* a test
   body** — the helper returns `Promise<Effect>`, and callers then yield that.
   Caught only by `tsc`.

Every one passes the count check, the text diff and the declaration count.

**Gate each batch on three signals, not one:** the counts (did the assertions
survive), `tsc` (is it well-typed), and a real run (does it execute). Counts
alone are the shape of a green that means nothing.

## The greps the count/text audit is structurally blind to

```text
yield\* import(
yield\* Effect\.run
Effect\.(runSync|runPromise|runPromiseExit|runSyncExit|runFork|runCallback)\b
```

Two auditing traps, both found the hard way:

- **Never use `expect` or `assert` as bare words in a test comment** — not even
  in prose. A comment containing "assert" registered as an assertion line in a
  `\b(expect|assert)\b` text extractor while the `\bexpect\(` count stayed
  clean, so the two gates disagreed silently and masked a real drop.
- **An anchored grep answers a narrower question than the sentence it ends up
  supporting.** A `yield*`-anchored runner grep cannot match a bare
  `Effect.runSync(...)` in a synchronous `it()` body. Related: **any converter
  or audit keyed on `async () => {` is structurally blind to sync `it()` bodies
  that call a runner** — which is exactly where the `Effect.runSync`
  fixture-laundering anti-pattern hides, because nobody inspects sync tests.

## The pre-flight before collapsing per-test provides into `layer()`

`layer()` memoizes; plain `Effect.provide` does not. Per-test provide is
therefore the **safe** default and collapsing to a suite-boundary `layer()` is
the **risky** move. See the main skill for the rule; the worked failures:

- Three tests asserting a stub call count read **4, 5 and 6 instead of 1**,
  because the `calls` recorder in the layer accumulated across the memoized
  group. Green the whole time. Only found by deliberately breaking a
  `beforeEach` and watching which tests failed to notice.
- A config service holding a never-self-expiring per-root cache, with two tests
  asserting what a *second* read sees "in the same runtime". Under `layer()` the
  cache is shared across the group and those two tests stop testing anything —
  still green. Grep candidates for the same shape: `refresh()`, a cache,
  memoization, "second call returns cached".

Two shapes are genuinely safe to collapse: a layer whose state is **on disk**
(filesystem `beforeEach` hooks still run) and a layer that is genuinely
**stateless** (`Logger.layer([])` — memoization is unobservable). In-memory
state — a `Ref`, a cache, a counter, a `calls` recorder — is not safe, and
neither is a stateful service whose *state lifetime* is the thing under test.

## The hang class that actually costs the time

Not the epoch. The hang comes from tests with **no `TestClock` reference at
all**, quietly relying on a 1–10ms real delay, which stops advancing the moment
the test moves to `it.effect`. In the largest package, all eight files that
already hand-wired `TestClock` converted cleanly; every genuine hang came from
files that never mention it — `withRetry` with `baseDelay: 10`,
`dispatchAndWait` with `intervalMs: 1`, a bare `Effect.sleep(100 millis)`, a
retry walking `Schedule.exponential("1 second")`.

**In three of four cases the sleep lived in `src`, not in the test file.**
Grep the *implementation* under test, not only the test:

```text
Effect\.sleep|Effect\.timeout|Schedule\.|Effect\.retry|Effect\.repeat|baseDelay|intervalMs|setTimeout\(
```

Dependencies wrap too, and a `src`-only audit misses that: `@effected/git`
wraps every invocation in `Effect.timeoutOrElse({ duration: Duration.seconds(30) })`.
That one is inert under the virtual clock — `timeoutOrElse` races, the real
subprocess wins, the virtual sleep arm never fires — but the reasoning had to be
done, not assumed.

## `vi.mock` and the re-export

Vitest hoists `vi.mock(...)` above all imports, so a `vi` bound through the
`@effect/vitest` re-export is not yet initialized at hoist time and the file
dies at load with a message naming neither `vi` nor `@effect/vitest`:

```text
Cannot access '__vi_import_1__' before initialization
```

The technical requirement is narrow: **`vi.mock` needs `import { vi } from
"vitest"`.** Measured across the converted repo — 24 files import `vi` from
`@effect/vitest` and work fine (all `vi.fn` / `vi.spyOn` only); every file
calling `vi.mock` imports `vi` from `"vitest"`; zero files call `vi.mock` with a
re-exported `vi`. `vi.fn` and `vi.spyOn` are ordinary runtime calls and are
unaffected.

Importing `vi` from `"vitest"` uniformly is defensible cheap insurance — adding
a `vi.mock` later to a file that got `vi` from the re-export breaks it at load —
but that is style, not the rule.

## Auditing console output is not a `console.*` grep

`it.effect` installs `TestConsole`, and Effect's **default logger writes through
the same ref** (`packages/effect/src/Logger.ts:273`, `:310`, `:354` all read
`options.fiber.getRef(effect.ConsoleRef)`). So `Effect.log` / `logWarning` /
`logError` are intercepted identically to `Console.*`. One repo's audit cleared
a package by grepping `Console.*` and missed three live `Effect.logWarning`
sites.

Only three emit paths are genuinely immune:

1. direct `console.*`,
2. direct `process.stdout.write` / `process.stderr.write`,
3. a **replaced** logger set (`Logger.layer([...])` without `mergeWithExisting`)
   writing to one of those.

The failure is silent and produced two vacuous passes — "expect no output in
quiet mode" tests that pass unconditionally because the sink `TestConsole`
drained is always empty.

**A test whose only assertions are negative is the vacuous-pass shape.** Where a
positive sibling exists, it is the cheap proof the sink is live.
