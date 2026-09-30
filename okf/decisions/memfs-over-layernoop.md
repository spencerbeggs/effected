---
type: Decision
title: A test needing FileSystem uses memfs, never a hand-rolled layerNoop stub
description: Migrate every test's filesystem double from FileSystem.layerNoop to @effected/memfs, because a hand-rolled stub only encodes the semantics its author remembered.
status: draft
tags:
  - testing
sources:
  - id: memfs-fs
    resource: ../../packages/memfs/src/MemoryFileSystem.ts
  - id: memfs-faultinjection-test
    resource: ../../packages/memfs/__test__/FaultInjection.test.ts
  - id: claude-md
    resource: ../../CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T01:39:09Z
  body_sha256: d4632c9697e6dfed46c26fdc4172a049fab79b78fd40135ed322394cf4e38d30
---

# A test needing FileSystem uses memfs, never a hand-rolled layerNoop stub

## Context

Effect core's `FileSystem.layerNoop` builds a `FileSystem` layer from a
partial set of method overrides and fails (as a defect) on every member
the caller did not supply. Before `@effected/memfs` existed, tests across
the kit that needed a `FileSystem` reached for `layerNoop` over a
hand-maintained `Map`, writing just enough method overrides to make the
test at hand pass.

## Decision

Every test in this repository that needs `FileSystem` provides
`@effected/memfs` as a devDependency instead of hand-rolling a
`FileSystem.layerNoop` stub.[^claude-md] `@effected/memfs` implements a
real, in-memory POSIX-like volume behind the `FileSystem` key, so every
member a test's code path touches — not just the ones a fixture's author
anticipated — behaves like a real filesystem would, including the
interactions between operations (a `readFile` after a `rename`, a
`readdir` after a nested `mkdir`).[^memfs-fs] Misbehavior is injected as a
fault over the real volume (`layerWith(seed, { faults })`), never as
a stub body that silently does nothing, so the fixture survives the code
under test growing a new call instead of failing on an
unimplemented member the moment it does.[^memfs-faultinjection-test]

## Alternatives rejected

**Keep `layerNoop` and write fuller overrides per test.** Rejected
because `layerNoop` is deny-by-default: it fails every member the
fixture's author did not think to write, which means a stub only ever
encodes the semantics that author had in mind at the time. A bug that
depends on any filesystem behavior the author did not anticipate — an
interaction between two operations, an edge case in a path the fixture
never exercised — cannot surface no matter how carefully the stub is
maintained, because the stub was never asked to model it.

**A hand-rolled `Map`-backed double per package.** Rejected for the same
reason from the other direction: a bespoke double, however carefully
written, encodes one author's mental model of the filesystem rather than
the filesystem's actual behavior, and every package would have to
rediscover the same gaps independently.

## Consequences

Migrating the kit's tests off hand-rolled `layerNoop` stubs onto
`@effected/memfs` surfaced defects in packages that had been passing
tests for years — bugs that depended on filesystem behavior no
hand-written stub had ever been asked to model. The value of a faithful
double is precisely the tests it stops passing: a test that used to pass
against an incomplete stub and now fails against a real volume is not a
new bug, it is an old bug the stub was hiding.

The corollary discipline for injected misbehavior follows from the same
argument: a handler that records a call and returns `undefined` is a spy,
not a replacement, because it counts the call *and* lets it really
happen. The fixture must instead *decline* the call to prove the fault
is load-bearing — disabling the fault and watching the tests that depend
on it die is the check that the fault was not decoration.

[^claude-md]: `CLAUDE.md` §Testing — "A test needing `FileSystem`
    provides `@effected/memfs`, never a hand-rolled `FileSystem.layerNoop`
    double."
[^memfs-fs]: `packages/memfs/src/MemoryFileSystem.ts:274,753` — contrasts
    the real-volume, delegate-by-default fault layers with
    `FileSystem.layerNoop`'s deny-by-default semantics.
[^memfs-faultinjection-test]: `packages/memfs/__test__/FaultInjection.test.ts`
    — fault-injection tests proving `layerWith` fault handlers are
    load-bearing.
