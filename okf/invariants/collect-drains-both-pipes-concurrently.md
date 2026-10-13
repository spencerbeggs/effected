---
type: Invariant
title: Run.collect drains stdout, stderr and the exit code concurrently
description: "@effected/commands' collectRaw reads a child's stdout, stderr and exit code under { concurrency: \"unbounded\" }; sequential collection deadlocks once either OS pipe buffer fills, and only an e2e test with pressure on both pipes at once can detect the regression."
status: stable
resource: ../../packages/commands/__test__/e2e/Run.e2e.test.ts
tags:
  - testing
sources:
  - id: run-collect-raw
    resource: ../../packages/commands/src/Run.ts
  - id: run-e2e-backpressure
    resource: ../../packages/commands/__test__/e2e/Run.e2e.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 096bab8ff379cbfb
---

# Run.collect drains stdout, stderr and the exit code concurrently

## The property

Every [`@effected/commands`](../modules/commands.md) `Run` combinator
that collects a child's output — `collect`,
`collectTee`, and the `text` / `lines` / `json` / `jsonLine` / `exitCode` /
`succeeds` family built on them — reads stdout, stderr and the exit code
**at the same time**, never one after another. A child that writes more
than one OS pipe buffer to each stream completes and its output is
captured in full.

## Why it must hold

Sequential collection deadlocks the moment either pipe buffer fills: the
child blocks writing to a full pipe while the reader that would drain it
is still waiting on the other stream, and the exit code never arrives
because the child never exits. The failure is silent — a hang, not an
error — and it only appears for children with enough output on both
streams, so it escapes small-fixture tests and surfaces in production
against a chatty `npm install` or `git fetch`.

## The mechanism

`collectRaw` in `packages/commands/src/Run.ts` runs the three reads under
`{ concurrency: "unbounded" }`, with a source comment naming the option as
load-bearing rather than stylistic.[^run-collect-raw]

The property is pinned by the e2e backpressure test in
`packages/commands/__test__/e2e/Run.e2e.test.ts`, which spawns a real
`node` child that writes 1 MiB to stdout, 1 MiB to stderr, and then the
same again, and asserts both captured streams total 2 MiB with exit code
0. If the concurrency option is ever relaxed, the test hangs to its
30-second timeout instead of failing fast.[^run-e2e-backpressure]

Two things about the test are not negotiable:

- **It has to be e2e.** A scripted spawner over in-memory streams has no
  pipe buffer and cannot reproduce the deadlock, so the unit suites
  cannot stand in for it.
- **The pressure has to be on both pipes at once.** Large output on one
  stream alone does not discriminate sequential from concurrent
  collection — the sequential reader drains that stream to completion,
  then reads the quiet one, and passes.

## What would break it

Rewriting `collectRaw` to read stdout, then stderr, then the exit code
(or to any `concurrency` below 3), or deleting the e2e backpressure test —
after which the deadlock would return unobserved. Neither change is
acceptable; a refactor that needs to touch the collection order must keep
the test green under a real platform layer.

[^run-collect-raw]: `packages/commands/src/Run.ts` — `collectRaw`'s
    `Effect.all(..., { concurrency: "unbounded" })` over the stdout,
    stderr and exit-code reads, with the comment that the option is
    load-bearing.
[^run-e2e-backpressure]: `packages/commands/__test__/e2e/Run.e2e.test.ts`
    — "collect drains stdout and stderr concurrently under simultaneous
    backpressure on BOTH pipes", the 30 s-timeout test whose header
    comment says do not delete it.
