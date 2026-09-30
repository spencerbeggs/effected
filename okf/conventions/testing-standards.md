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
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T01:39:09Z
  body_sha256: 0c8fb2856835b9ef2052d58921835a5aa9db3f4fa5b497d093afb478eb482498
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
[^claude-md]: `CLAUDE.md` §Testing — "tests live in each package's
    `__test__/` directory, never co-located in `src/`."
