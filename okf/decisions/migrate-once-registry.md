---
type: Decision
title: Store.migrateOnce keeps a process-global registry of plain Promises
description: Store.migrateOnce deduplicates migration runs through one Map on globalThis under an unversioned Symbol.for key, holding never-rejecting Promises of plain outcome objects, so independent runtimes and module copies in one process share a run; failures are not cached, and it is not a lock.
status: draft
tags:
  - architecture
  - compat
sources:
  - id: migrate-once-source
    resource: ../../packages/store/src/internal/migrateOnce.ts
  - id: store-source
    resource: ../../packages/store/src/Store.ts
  - id: registry-test
    resource: ../../packages/store/__test__/migrateOnceRegistry.test.ts
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-10-26T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: df3ccba7a2b977d5
---

# Store.migrateOnce keeps a process-global registry of plain Promises

## Context

A consumer process can hold several reporters or workers that each open
the same SQLite database, each from its own `Effect.runPromise` runtime.
Layer memoization does not span runtimes, so nothing in Effect stops each
one migrating the file. The consumer's hand-rolled replacement keyed a
promise cache on the raw path string (so relative, absolute and symlinked
spellings each ran) and kept a rejected promise forever (so one transient
`SQLITE_BUSY` poisoned the process). The owner accepted a process-global
registry for `Store.migrateOnce`.[^owner-ruling]

## Decision

The registry is a `Map<string, Promise<Outcome>>` at
`globalThis[Symbol.for("@effected/store/migrateOnce")]`.[^migrate-once-source]

- **Process-global, unversioned.** Every copy of `@effected/store` in the
  process (a bundled reporter beside a CLI, possibly different versions on
  different Effect instances) shares one registry, which is the point:
  per-module state would deduplicate only inside one copy.
- **A `Promise`, not a `Deferred`.** Values are promises that never reject,
  resolving to a plain object tagged `Success`, `Failure`, `Defect` or
  `Interrupted`. No `Exit`, `Cause`, `Deferred` or `Fiber` is ever stored:
  those are Effect-instance internals that another copy cannot trust. A
  waiter in the copy that ran replays the full `Cause` from a module-local
  `WeakMap` keyed by the outcome object; a waiter in another copy rebuilds
  from the plain outcome, so the error it sees fails its own `instanceof`
  while `catchTag` still matches.
- **The key** is the realpath of the file's directory joined with the
  basename, a NUL, then a JSON fingerprint of the migration ids and names
  and the `adoptMigratorLedger` / `mirrorMigratorLedger` options.[^store-source]
  The directory, not the file, is resolved because the first open creates
  the file while the driver never creates a directory.
- **Failures are not cached.** A failed, defected or interrupted run
  deletes its entry before releasing its waiters, so the next call starts a
  fresh run.
- **Registration and the fork are uninterruptible**; only the wait is
  restored. The run is `forkDetach`ed and settles through `onExit`, so a
  caller's interruption and runtime shutdown never strand a waiter. A
  caller interrupted between registration and fork once left a promise no
  fiber would settle; the registry test sweeps `MaxOpsBeforeYield` to pin
  the mask.[^registry-test]
- **It deduplicates work and is not a lock.** A success is remembered per
  path for the process lifetime, with no reset. Concurrent safety, across
  processes too, comes from every `Store` build re-checking the ledger
  under `BEGIN IMMEDIATE`.

The symbol, the key format and the `Outcome` shape are a frozen
cross-version contract: a change to any of them takes a new symbol, so an
old and a new copy stop sharing rather than misreading each other.

## Alternatives rejected

**A module-local cache.** Rejected because two copies of the package in one
process would each migrate, which is the case the API exists for.

**Storing a `Deferred` or an `Exit` in the shared registry.** Rejected
because a copy on a different Effect instance would be reading another
instance's internal structures.

**Caching failures like successes.** Rejected because one transient
failure would poison every later call in the process.

**A cross-process file lock.** Not needed: the ledger re-check under the
write lock already makes concurrent opens safe, and `migrateOnce` only
saves the redundant work.

## Consequences

A database deleted and recreated at the same path is not re-migrated by
`migrateOnce`; callers that do that open it with `Store.layerSqlite`, which
always migrates. Case variants of a path on a case-insensitive filesystem
key separately and run twice, which is safe. `:memory:`, `""` and `file:`
URIs name no shared file and die as wiring.

[^owner-ruling]: Conversation with the repository owner, 2026-10-26: the process-global registry for `Store.migrateOnce` is accepted.
[^migrate-once-source]: `packages/store/src/internal/migrateOnce.ts` — the registry, the `Outcome` type and the cross-version contract comment.
[^store-source]: `packages/store/src/Store.ts` — `migrateOnce`, the fingerprint and the `realPath` of the directory.
[^registry-test]: `packages/store/__test__/migrateOnceRegistry.test.ts` — the interruption sweep over `Scheduler.MaxOpsBeforeYield`.
