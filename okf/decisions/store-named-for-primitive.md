---
type: Decision
title: Store is named for its primitive, not its backend
description: The package name and public surface describe a schema-versioned migrated SqlClient and a TTL cache — nouns any SQL driver could satisfy — never the specific SQLite implementation behind them today.
status: draft
tags:
  - architecture
sources:
  - id: store-claude-md
    resource: ../../packages/store/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 7823558286293c1a
---

# Store is named for its primitive, not its backend

## Context

`@effected/store` ships one runtime dependency, `@effect/sql-sqlite-node`
(see [store is v4 SQLite](store-v4-sqlite.md)), and today that is the
only driver its `layerSqlite`/`layerTest` convenience layers wire up.
Naming the package or its services after SQLite would have been the
obvious shorthand.

## Decision

The package and its two services are named for what they are — a
schema-versioned migrated `SqlClient` (`Store`) and a `key -> Uint8Array`
cache with TTL, tags and eviction (`Cache`) — sharing one
migration-ledger engine, rather than for the SQLite driver that backs
them today. The driver-agnostic `layer` static on both services requires
only an abstract `SqlClient` in `R`, so any v4 Effect SQL driver
satisfies it; the SQLite-naming statics (`layerSqlite`, `layerTest`) are
explicitly the ones that name the driver, and no store type signature
outside them exposes a `SqliteClient` type.

## Alternatives rejected

- **Name the package or services after SQLite** (for example
  `SqliteStore`, `SqliteCache`). Rejected: it would misdescribe the
  driver-agnostic `layer` seam and imply a coupling the package
  deliberately avoids — a future non-SQLite driver would then force a
  rename rather than simply satisfying the existing abstract layer.

## Consequences

Adding a second SQL driver in the future costs no rename: the package
name, `Store` and `Cache` already describe the primitive rather than
today's implementation. Any change that would make the driver visible on
an abstract-facing type signature is a regression against this decision,
not a refactor to accept.
