---
id: "0010"
title: "effect: effect/sql's Migrator now runs a migration with id 0 on a fresh database"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.6"
detect: ["Migrator"]
---

`Migrator.make` (and every driver's `run`/`layer`) treated a database with no recorded migrations as if its latest id were `0`, so a migration with id `0` (`0000_init`, `0_zero`) was silently skipped on a fresh database. It now runs (probed: on a fresh SQLite file, `{ "0_zero", "1_one" }` applied only `1_one` before and applies both now). Databases that already record a migration are unaffected: an id at or below the latest recorded one is still skipped.

Search for `Migrator` and look for a migration keyed `0`. On a fresh database it now runs, so a test or a setup script that compensated by creating that schema another way may now fail with "table already exists". An existing database migrated before the upgrade never ran id `0` and still will not run it, because its latest id is higher. If that migration matters, apply its effect by hand or move it to a new id. `@effected/store` is unchanged here: its own migrations still take positive integer ids, and `Store.fromMigratorRecord` with a `0_` key still dies at `Store.layer`.
