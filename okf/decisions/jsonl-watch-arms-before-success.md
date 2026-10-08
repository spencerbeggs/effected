---
type: Decision
title: jsonl's watch is a service in R that succeeds only once registered, with a Node backend behind ./node
description: "@effected/jsonl requires its own JournalWatcher, whose watch effect succeeds only after the platform watch is registered, instead of arming core's FileSystem.watch on a scheduler heuristic; the Node implementation ships behind an opt-in ./node subpath."
status: stable
tags:
  - architecture
  - bundle
  - testing
sources:
  - id: journal-watcher
    resource: ../../packages/jsonl/src/JournalWatcher.ts
    title: The JournalWatcher service and its arm-before-success contract
  - id: node-journal-watcher
    resource: ../../packages/jsonl/src/NodeJournalWatcher.ts
    title: NodeJournalWatcher.layer, registering node:fs watch synchronously inside an acquireRelease
  - id: engine
    resource: ../../packages/jsonl/src/internal/engine.ts
    title: followJournal, awaitCreation and supervise
  - id: watcher-test
    resource: ../../packages/jsonl/__test__/Watcher.test.ts
    title: "The \"watcher — the arming window\" suite"
  - id: entrypoints-test
    resource: ../../packages/jsonl/__test__/entrypoints.test.ts
    title: The entrypoint boundary test
  - id: core-watch-backend
    resource: ../../.repos/effect/packages/effect/src/FileSystem.ts
    title: "Core's FileSystem.WatchBackend: register returns Option<Stream>"
  - id: node-filesystem
    resource: "npm:@effect/platform-node-shared/src/NodeFileSystem.ts"
    title: "Core's Node watch: stat, then Stream.unwrap over the registering stream"
  - id: owner-no-consumers
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-10-08T00:00:00Z
    title: jsonl has no consumers yet, so a breaking minor is acceptable
generated:
  by: "okfit/claude-code"
  at: 2026-10-08T06:11:30Z
  body_sha256: ecc261bac9035d396b8e79806542ad67accd88f70f668d896a9b6cd5f39beaeb
verified:
  - by: human:spencer
    at: 2026-10-08T06:10:41Z
---

# jsonl's watch is a service in R that succeeds only once registered, with a Node backend behind `./node`

## Context

The [journal](../interfaces/jsonl-journal.md) arms a watch, reads what it
missed, then follows the watch. That order is only safe if "armed" means
*registered*: an append landing after the catch-up read but before the
platform watch is live is on neither path, and stays invisible until some
later append fires an event.

Core's `FileSystem.watch` gives no registration signal. On Node it runs an
asynchronous `stat` — real I/O — before calling `node:fs` `watch`, and the
stream it returns registers inside a fiber it forks, so the
caller cannot observe when the watch went live.[^node-filesystem] The engine
bridged that gap by forking the watch and yielding a fixed number of
scheduler turns before its catch-up read. Under CPU load the catch-up won
the race: the integration test in which two journal layers over one file
observe each other's appends timed out in 4 of 12 and 4 of 16 runs, and
instrumentation showed the reader's `latest` never left `None`, so the
reader never ingested the append at all. The same window existed on the
activation path, where the existence check ran before the directory watch
was registered.

An earlier source comment named `FileSystem.WatchBackend.register` as the
airtight primitive. It is not: `register` returns an
`Option<Stream>`,[^core-watch-backend] a lazy stream that still arms when
it is run, in a fiber of its own, and `@effect/platform-node` ships no Node
`WatchBackend` layer to provide.

## Decision

`@effected/jsonl` owns the seam. Its root exports `JournalWatcher`, a
`Context.Service` whose `watch(path)` returns
`Effect<Stream<string | undefined, PlatformError>, PlatformError, Scope>`,
with a contract the effect itself carries:[^journal-watcher]

- The effect succeeds only once the watch is registered; every change after
  success is on the stream.
- The watch lives until the enclosing scope closes.
- A missing path fails `PlatformError` with reason `NotFound`.
- Elements are untyped pokes — a possibly-bare name, possibly absent — that
  the journal never opens.

`Journal.layer` and `make` require `FileSystem | JournalWatcher` in `R`.
The engine's order is arm, catch-up, follow by construction: `followJournal`
yields the registered watch before it ingests, and `awaitCreation` arms the
directory watch *before* it checks whether the journal exists, each cycle in
its own `Effect.scoped`.[^engine]

The Node implementation, `NodeJournalWatcher.layer`, lives behind the
`@effected/jsonl/node` subpath and calls `node:fs` `watch` synchronously
inside an `acquireRelease`, so registration is complete when the effect
succeeds.[^node-journal-watcher] The root still reaches no `node:*` module,
and a test walks the root's import graph to pin it, with a positive control
on `./node`.[^entrypoints-test]

The change is breaking, taken as a `0.x` minor; jsonl has no consumers to
migrate.[^owner-no-consumers]

## Alternatives rejected

- **Keep the scheduler-turn heuristic, or replace it with an I/O round
  trip.** Rejected. Either is a guess at how long registration takes, not a
  proof that it happened. More turns or a `stat` round trip narrows the
  window under one load profile and leaves it open under a heavier one.
- **Require core's `FileSystem.WatchBackend` in `R`.** Rejected. `register`
  hands back an opaque lazy stream that still arms in a forked fiber, so it
  carries no more of a registration signal than `FileSystem.watch` does, and
  there is no Node layer for it, so every consumer would have to write one.
- **Make the integration test tolerate the miss** — a longer timeout, or a
  second append to flush the first. Rejected. The test was right: a journal
  that loses an append until the next one arrives is the bug, and loosening
  the test would ship it.

## Consequences

- Every consumer provides a `JournalWatcher` alongside `FileSystem`; on Node
  that is `NodeJournalWatcher.layer`, and on another platform it is a small
  implementation over that platform's watch that honours the
  arm-before-success contract.
- `./node` is the package's one platform-bound surface, read per entrypoint
  the way [cli's `./ui`](ui-tier-is-integrated-on-opt-in.md) is: the root
  stays boundary, and only a consumer who imports `./node` takes the
  platform edge. It imports only the `node:fs` built-in, so it adds no
  install. Its declarations name root types through the package's own name,
  the same posture as [cli's ui
  declarations](ui-declarations-reference-the-root-by-name.md).
- The engine no longer calls `FileSystem.watch`, so the unit-test seam moved
  from a memfs `watch` fault to a `JournalWatcher` double that stats
  through the volume and then registers synchronously. Its `holdNextWatch`
  suspends one watch between the stat and the registration, which lets two
  deterministic tests land a write, and a creation, inside the window;
  each fails against a mutant that restores the old order.[^watcher-test]
- Every element is a poke, including one the platform reports with no
  filename, which core's Node watch would have dropped.

[^journal-watcher]: `packages/jsonl/src/JournalWatcher.ts`
[^node-journal-watcher]: `packages/jsonl/src/NodeJournalWatcher.ts`
[^engine]: `packages/jsonl/src/internal/engine.ts`
[^watcher-test]: `packages/jsonl/__test__/Watcher.test.ts`, "watcher — the arming window"
[^entrypoints-test]: `packages/jsonl/__test__/entrypoints.test.ts`
[^core-watch-backend]: `.repos/effect/packages/effect/src/FileSystem.ts`, `WatchBackend`
[^node-filesystem]: `@effect/platform-node-shared`, `src/NodeFileSystem.ts`, `watch` and `watchNode`
[^owner-no-consumers]: conversation with the repository owner, 2026-10-08
