---
type: Convention
title: Testing standards
description: "@effect/vitest as the default runner, assert.* never expect, memfs as the real filesystem double, no process.env writes, a test file's kind in its suffix, growth checks in place of elapsed-time assertions, depth from @effected/testing, the slow tier, and why the oracle for a ported algorithm must be external."
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - testing
sources:
  - id: semver-comparator-test
    resource: ../../packages/semver/__test__/Comparator.test.ts
  - id: memfs-faultinjection-test
    resource: ../../packages/memfs/__test__/FaultInjection.test.ts
  - id: memfs-fs
    resource: ../../packages/memfs/src/MemoryFileSystem.ts
  - id: claude-md
    resource: ../../CLAUDE.md
  - id: vitest-setup
    resource: ../../vitest.setup.ts
  - id: no-process-env-mutation-test
    resource: ../../__test__/no-process-env-mutation.test.ts
  - id: vitest-config
    resource: ../../vitest.config.ts
  - id: test-kinds-test
    resource: ../../__test__/test-kinds.test.ts
  - id: growth-ts
    resource: ../../packages/testing/src/Growth.ts
  - id: registry-kind-hostile-test
    resource: ../../packages/npm/__test__/RegistryKind.hostile.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-25T13:41:08Z
integrity:
  generated:
    body: 0a7f85b1b0971e4b
---

# Testing standards

- `@effect/vitest`: `it.effect` is the default test mode, providing
  `TestClock` and `TestConsole`; `it.live` only when real `Clock` or
  runtime behavior is genuinely required.[^semver-comparator-test] Never
  plain `it()` + `Effect.runPromise` for routine Effect code.
- Shared setup goes through a top-level `layer(ServiceLayer)((it) => {
  ... })`, built once and memoized, scoped to the group; `it.layer(...)`
  for nested isolation. The anti-pattern is repeating
  `Effect.provide(Layer)` inside each test body — provisioning belongs at
  the boundary, not per test.
- An integration suite over a shared, expensive real-world fixture — a
  temp-dir git repository driven by a real spawner, for instance — may
  use plain `beforeAll`/`afterAll` with `Effect.runPromise` to build and
  tear the fixture down once per file; `@effected/git`'s integration
  suites are the sanctioned example. The per-test `Effect.ensuring`
  pattern remains the default for cheap per-test fixtures.
- `TestClock.adjust` for time control with forked fibers.
- Property-based tests use `it.effect.prop` with FastCheck arbitraries;
  Schema inputs go through `Schema.toArbitrary`, since top-level `it.prop`
  does not support Schema inputs.[^semver-comparator-test]
- `assert.*` for uniform, explicit checks — **never `expect`**.
  `flakyTest` is reserved for genuinely flaky integration conditions, not
  a way to paper over a nondeterministic assertion.
- Tests live in each package's `__test__/` directory per repository
  convention, never co-located in `src/` — unit tests as `*.test.ts`,
  plus `e2e/` and `integration/` subdirectories where a package needs
  them.[^claude-md]

## The filesystem double is a real volume

A test needing `FileSystem` provides `@effected/memfs` as a
devDependency, never a hand-rolled `FileSystem.layerNoop` over a `Map`.
`layerNoop` is deny-by-default — it fails every member the fixture's
author did not think to write — so a stub encodes only the semantics that
author had in mind, and a bug depending on anything else cannot
surface.[^memfs-fs] Swapping hand-rolled stubs for a real volume across
the kit surfaced defects in packages that had been passing tests for
years — the value of a faithful double is the tests it stops passing.

Three rules generalize from that migration:

- **Inject a misbehavior as a fault, not as a stub body.**
  `layerWith(seed, { faults })` delegates every method a handler
  declines, so the fixture survives the code under test growing a new
  call — where a `layerNoop` stub starts failing on any unimplemented
  member instead.[^memfs-faultinjection-test] Then prove the fault is
  load-bearing by disabling it and watching the tests it should break
  actually die; a fault nothing depends on is decoration.
- **A handler that records and returns `undefined` is a spy, not a
  replacement.** It counts the call *and* lets it really happen. The
  mutant such a fixture must kill is precisely the one that swallows a
  write while still counting it — a stub body does not kill that mutant,
  a declining handler does.
- **Assertion timing picks the constructor family.** The `layer*` forms
  re-seed a fresh volume per `Effect.provide`, so they fit tests that
  assert *inside* the effect. The `make*` forms plus `Layer.succeed` pin
  one volume's identity for tests that assert *after* it runs. Used
  backwards, a post-run assertion reads a volume nobody wrote to.

A consumer-supplied sync filesystem port takes a volume too — it does not
require `FileSystem`, only a small structural port from its caller, so
the double for it is `MemoryFileSystem.syncFileSystem(volume)`.

A double that exists to control *timing* rather than to hold bytes is a
different artifact and stays hand-written; `@effected/jsonl`'s watch
harness is the standing example of that exception.

## Tests never write process.env

Never assign to, delete from, or `Object.assign` into `process.env` in a
test. `process.env` is shared by every file a vitest worker runs, so a
missed restore, an early throw, or two files touching the same key make
unrelated tests pass or fail. Provide the value through the code's own seam
first — a test `ConfigProvider`, `Git.withRunOptions({ env })` or
`Git.layerRunOptions(...)` for a whole suite, a spawn's `env` option. Where a
test genuinely needs the parent's ambient environment, use `vi.stubEnv(...)`
with `vi.unstubAllEnvs()` in `afterEach` or `afterAll`. Reading
`process.env` is fine. The rule (issue 1379) is held by a root structural
test that tokenizes every test file and fails on a write.[^no-process-env-mutation-test]

## A test file's kind is its suffix

Name a test file for what it proves, because the name is what places it in
a run:

| Suffix | Use it for |
| --- | --- |
| `.test.ts` | base cases; also `.int.test.ts` and `.e2e.test.ts` |
| `.parity.test.ts` | a comparison with a reference implementation whose sample and full runs differ |
| `.corpus.test.ts` | a recorded spec or fixture corpus whose sample and full runs differ |
| `.property.test.ts` | generated inputs, properties and exhaustive grids, whose run count or size differs by depth |
| `.hostile.test.ts` | growth checks on adversarial input |

Give a file a `.parity`, `.corpus` or `.property` suffix only when it reads
its depth from the test kit. A cheap corpus suite whose whole pass already
runs on every pull request keeps a plain name. Give a file the `.hostile`
suffix only when it measures growth: a suite of adversarial inputs that
asserts answers and reads no clock is a unit file, and renaming it would
only take it out of the coverage run.

The root `__test__/test-kinds.test.ts` fails a file that reaches `Growth`,
`Depth` or `Corpus` under the wrong name, and a file that carries a suffix
without reaching the matching API.[^test-kinds-test] Which run each suffix
lands in → [the vitest test tiers](../decisions/vitest-test-tiers.md).

## No test asserts an elapsed time

Never assert an elapsed time as a claim about how fast kit code runs. A
ceiling in milliseconds holds on the machine that set it and fails on a
loaded runner. Assert how the work grows with its input instead:

- Use `Growth.assertOrder` from
  [`@effected/testing`](../modules/testing.md), or `Growth.measure` with a
  stated bound, in a `.hostile.test.ts` file. Four times the input should
  cost about four times the CPU time for linear work, and about sixteen for
  quadratic.
- **Size it small**: tens of thousands of characters for a scan. `Growth`
  repeats a short run until it can be timed, so a larger input adds no
  accuracy, and it makes a quadratic regression take minutes to report
  where a small one fails in seconds.[^growth-ts]
- **Have the work return what it computed.** `Growth` keeps each run's
  result, and a call whose result nothing reads is one the optimizer may
  drop, which then times as nothing. Where the work is a call on one fixed
  argument that the optimizer can fold, alternate two inputs.
- Keep the assertion on what the input returns in the package's unit file.
  Hostile files run with coverage off, so the unit file is what keeps the
  path in the coverage run.
- A fixed input with nothing to scale keeps its answer and no bound of its
  own; the growth check on the scaled shape beside it and the hostile tier's
  60-second test timeout are the bound.
- **A deadline on an external process is the test's timeout.** A child that
  must be killed, a lock that must be taken over: state the limit as the
  test's `timeout` option or an `Effect.timeout`, and delete the elapsed
  assertion.

Nothing under a package's `__test__/` reads a clock (`process.cpuUsage`,
`process.hrtime`, `performance.now`, `Date.now`) except the files named in
`ALLOWED_CLOCKS` in `__test__/test-kinds.test.ts`, each with its
reason: a lower bound, a fixture's timestamp, a deadline across two
processes. Adding a file there needs a reason of that kind, never a speed
claim.[^test-kinds-test]

## Depth comes from the test kit

Read how much input a test runs from `@effected/testing`, never from a
variable of the package's own:

- `Depth.pick({ sample, full })` for a run count or a grid size.
- `Corpus.select(all, { sample })` for which entries of a corpus to read.
  Commit the sample as a list of names, so a failure reproduces.
- `Corpus.pin(actual, expected)` for an exact count over a corpus, which is
  a fact about the whole corpus and is checked at full depth only.

The depth is `sample` by default, on every pull request and every local
run, and `full` under `EFFECTED_TEST_DEPTH=full`, which `pnpm test:full`
sets. Keep every non-vacuity assertion (the reference found something) at
both depths; where a sample makes one vacuous, add a fixture to the sample
or an input of the test's own.

## Prove a check by watching it fail

The proof of a growth check, as of any check, is watching it fail on the
slow form. Put the slow code back (the regex the scan replaced, the memo
removed), run the check, read a ratio near sixteen against a bound of ten,
and restore.

**A mutation used to prove a check must have an observable effect.** A
quadratic rescan injected with its result unused is optimized away, and the
check passes over a mutant that does no extra work. Make the mutant's work
reach the result.

A proof can also show the input is wrong. A check over a long run of
slashes, carried over from a ceiling test, passed against the regex that
test's comment named as the hazard, because that regex matches at the first
slash at once; only the run followed by a line break makes it
backtrack.[^registry-kind-hostile-test]
A check nobody has watched fail may be guarding nothing.

## Slow files run in their own tier

A test file that takes about 20 seconds or more on a CI runner by its
nature (a packed-install e2e, a reload test, a bundle test, a sweep) goes
in `vitest.config.ts`'s `SLOW_TESTS`, which moves it out of the coverage
run into the slow tier; the list must name files that exist and may not
name a hostile file, or the config refuses to load.[^vitest-config] Why
the tiers exist and how each is selected →
[the vitest test tiers](../decisions/vitest-test-tiers.md).

## The build before the run is not a given

Every cross-package import resolves to a sibling's `src/` over the workspace
link, so an ordinary test sees an upstream edit with no build. Tests that read
built output are the exception: the root `globalSetup` rebuilds those packages'
`dist/prod` through `AgentPlugin.runScript` before every vitest run, so such a
test sees an edit only when that build actually ran — and `runScript` has a short-circuit that skips it: a done-marker it writes on each
success, trusted without re-running the command while it is younger than
`VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` (30 s by default). The window
exists so a *concurrent* second vitest process trusts the winner's build
instead of racing it, but it applies to the next *sequential* run just
the same: edit a package's `src`, run a built-output test inside 30 s of the
previous run, and the test reads the previous `dist/prod`. It was reproduced,
under the earlier dev target, with a sentinel export and a downstream test: the
run inside the window failed with the build's `generatedAt` unmoved, and the
same run with the window disabled rebuilt and passed.[^vitest-setup]

The setup therefore pins the window to 1 ms unless the environment
already sets it, so every run rebuilds; turbo's cache keeps that a
few-second no-op when nothing changed, and the lock still serializes
concurrent runs. Two consequences for diagnosis:

- **A built-output test that ignores an edit is a build that did not run,
  not a turbo input gap.** `build` already lists `src/**`. Check
  `dist/prod/issues.json`'s `generatedAt` against the edit before reading the
  test as wrong.
- **Never set `VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` above 1 in this
  repo** to make runs feel faster; the time saved is turbo's cache
  hit, and the price is a stale build read silently.

## The oracle for a ported algorithm is external

When an implementation and a remembered constant disagree, neither one
is the oracle — climb to the published intermediates instead. A signing
algorithm ported from a specification should be pinned against the
specification's own documented intermediate values (a canonical-request
hash, a signing-key derivation), not against a remembered end-to-end
example that may belong to a different worked case entirely. Where the
artifact has a published schema, the schema is the oracle: an emitted
document format is validated against its own published JSON Schema,
vendored as a test fixture, rather than against a hand-maintained
approximation of that schema.

**Never pin your own output as the fixture.** A snapshot of what the code
currently emits asserts only that it has not changed, which is the one
property that was never in doubt.

[^semver-comparator-test]: `packages/semver/__test__/Comparator.test.ts`
    — `it.effect` as the default mode and `it.effect.prop` with a
    `Comparator` schema arbitrary.
[^memfs-faultinjection-test]: `packages/memfs/__test__/FaultInjection.test.ts`
    — fault-injection tests over `layerWith` `faults`.
[^memfs-fs]: `packages/memfs/src/MemoryFileSystem.ts:274` — contrasts the
    delegate-by-default fault layers with `FileSystem.layerNoop`'s
    deny-by-default behavior.
[^vitest-setup]: `vitest.setup.ts` — pins
    `VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` to 1 ms before
    `AgentPlugin.runScript`, with the reproduction recorded in the comment.
[^no-process-env-mutation-test]: `__test__/no-process-env-mutation.test.ts`
    — the token-level scan for assignments and mutating calls on `process.env`.
[^vitest-config]: `vitest.config.ts` — `SLOW_TESTS` and the check that
    refuses a missing or a hostile entry.
[^test-kinds-test]: `__test__/test-kinds.test.ts` — the four rules and
    `ALLOWED_CLOCKS`.
[^growth-ts]: `packages/testing/src/Growth.ts` — the sizing guidance in
    `Growth`'s remarks.
[^registry-kind-hostile-test]: `packages/npm/__test__/RegistryKind.hostile.test.ts`
    — the comment on why the run of slashes alone does not show the
    backtracking.
[^claude-md]: `CLAUDE.md` §Testing — "tests live in each package's
    `__test__/` directory, never co-located in `src/`."
