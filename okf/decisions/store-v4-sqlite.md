---
type: Decision
title: Store is built on effect's own SQL core and @effect/sql-sqlite-node
description: Store uses the SqlClient abstraction shipped inside effect core plus the Node sqlite driver, and hand-rolls its own reversible migration ledger rather than core's forward-only Migrator.
status: draft
tags:
  - architecture
sources:
  - id: store-package-json
    resource: ../../packages/store/package.json
  - id: store-claude-md
    resource: ../../packages/store/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: f446e5a2d425c545c9f91cad355fa642cf8518a894e2a08e016b4dae7dc5525c
---

# Store is built on effect's own SQL core and @effect/sql-sqlite-node

## Context

`@effected/store` needs a database seam for `Store` (a migrated
`SqlClient`) and `Cache` (a key-value cache over the same primitive). On
the v4 line, the SQL abstraction — `SqlClient`, `Statement`, `SqlError`,
transactions — lives inside `effect` itself, under
`effect/sql/*`; there is **no separate `@effect/sql` package**
on this release line.

## Decision

The abstract seam is `SqlClient` from `effect/sql`; the concrete
driver is `@effect/sql-sqlite-node`, published on the same version train
as `effect` and implemented over Node's built-in `node:sqlite` — no
native compile step, no `better-sqlite3`, no transitive
peers.[^store-package-json] Two facts are load-bearing:

- `effect/sql` is an unstable namespace upstream. The whole repo
  pins one catalog version, so surface drift is caught at catalog bumps
  rather than by consumers.
- `SqliteClient.layer` has no error channel. Driver construction
  failures — chiefly a `filename` whose parent directory does not exist
  — arrive as **defects**, not typed failures, which is why
  `layerSqlite`/`layerTest` publish only the domain error in `E`. A
  package wiring a database path must ensure the directory exists before
  the layer is built; see [app](../modules/app.md#the-ensure-before-open-contract)
  for where that ordering lives.

Core's own `effect/sql/Migrator` is deliberately **not** used:
it is forward-only — no `down`, no rollback, no status projection — and
`Store`'s contract carries all three, so `src/internal/migrator.ts` owns
a hand-rolled reversible ledger engine instead.

## Alternatives rejected

- **Depend on a separate `@effect/sql` package.** Rejected: no such
  package exists on the v4 line; the SQL core shipped into `effect` core
  itself.
- **Use `effect/sql/Migrator` for the ledger.** Rejected: it is
  forward-only, and `Store`'s contract requires rollback and status
  projection that core's migrator does not provide.
- **A different SQLite driver (`better-sqlite3`, a WASM build).**
  Rejected: `@effect/sql-sqlite-node` rides Node's built-in `node:sqlite`,
  costing no native compile step and no transitive peers, and it already
  ships on the same version train as `effect`.

## Consequences

`@effect/sql-sqlite-node` is store's one runtime dependency and is what
makes it [integrated tier](../glossary/library-tier.md) — see
[store is named for its primitive](store-named-for-primitive.md) for why
that dependency does not become the package's name. Every consumer of
store becomes tier 3 in turn, which is the reasoning behind
[xdg does not depend on store](xdg-does-not-depend-on-store.md).

[^store-package-json]: `packages/store/package.json` —
    `dependencies: { "@effect/sql-sqlite-node": "catalog:effect" }`, the
    package's one runtime dependency.
