---
"@effected/store": minor
---

## Features

### Keyed SQLite stores

* `Store.layerSqliteAs` and `Cache.layerSqliteAs` open a SQLite store under your own service key.
* `Store.sqlClient` exposes the `SqlClient` behind a keyed store.
* `onConnect` runs once per connection, for pragmas and similar setup.

### Migrator ledger adoption and mirroring

* `adoptMigratorLedger` imports an existing `effect/sql` Migrator ledger one time, honouring its rollback history. It is SQLite only and refuses with typed errors when it cannot adopt safely.
* `mirrorMigratorLedger` keeps the Migrator ledger in step both ways for matching rows, and records rollback tombstones so a mirrored import cannot resurrect a rolled-back migration.
* Both options are typed `boolean | { table }`; `false` turns them off.

### Observability

* Debug logs now report `Running migration`, `Migrations complete`, `Adopted migrator ledger` and `Imported migration`.
* `StoreError.message` includes the cause's innermost message, and `StoreError.operation` gains `"adopt"`.

## Bug Fixes

* Concurrent openers no longer run the same migration twice: each migration is re-checked under `BEGIN IMMEDIATE`.
* Rollback now records history in a lazily created `_store_meta` table.

## Documentation

* Documents a first-open WAL lock limit: simultaneous first opens of one database can hit `SQLITE_BUSY`. Warm the database up with a single open, retrying only that open, before sharing it.
