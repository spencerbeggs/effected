---
type: Convention
title: Testing standards
description: "@effect/vitest as the default runner, assert.* never expect, memfs as the real filesystem double, and why the oracle for a ported algorithm must be external."
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
generated:
  by: "okfit/claude-code"
  at: 2026-10-24T00:35:53Z
integrity:
  generated:
    body: 23bd4b59c3afeb1d
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

## The build before the run is not a given

The root `globalSetup` rebuilds `dist/dev` through `AgentPlugin.runScript`
before every vitest run, and every cross-package import resolves to a
sibling's `dist/dev/pkg` (the `publishConfig.directory` the workspace
link points at), never to its `src/`. So a downstream test sees an
upstream `src` edit only when that build actually ran — and `runScript`
has a short-circuit that skips it: a done-marker it writes on each
success, trusted without re-running the command while it is younger than
`VITEST_AGENT_RUNSCRIPT_BUILT_RECENTLY_MS` (30 s by default). The window
exists so a *concurrent* second vitest process trusts the winner's build
instead of racing it, but it applies to the next *sequential* run just
the same: edit a leaf package's `src`, run a downstream project inside
30 s of the previous run, and the test reads the previous `dist/dev`.
Reproduced with a sentinel export added to `@effected/semver` and a
`@effected/npm` test asserting on it — the run inside the window failed
with `semver/dist/dev/issues.json`'s `generatedAt` unmoved; the same run
with the window disabled rebuilt and passed.[^vitest-setup]

The setup therefore pins the window to 1 ms unless the environment
already sets it, so every run rebuilds; turbo's cache keeps that a
few-second no-op when nothing changed, and the lock still serializes
concurrent runs. Two consequences for diagnosis:

- **A downstream test that ignores an upstream edit is a build that did
  not run, not a turbo input gap.** `build:dev` already lists `src/**`.
  Check `dist/dev/issues.json`'s `generatedAt` against the edit before
  reading the test as wrong.
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
[^claude-md]: `CLAUDE.md` §Testing — "tests live in each package's
    `__test__/` directory, never co-located in `src/`."
