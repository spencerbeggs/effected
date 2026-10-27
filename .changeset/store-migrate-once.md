---
"@effected/store": minor
---

## Features

* `Store.migrateOnce(options)` runs a database's migrations once per process, shared across independent runtimes and keyed on the parent directory's real path plus the migration set. A failed run is not cached. It deduplicates; it is not a lock.
* `Store.fromMigratorRecord(record)` converts an effect/sql `Migrator.fromRecord`-style record into `StoreMigration`s.

## Bug Fixes

* Error messages no longer throw when an underlying error's `message` or `cause` getter throws.
