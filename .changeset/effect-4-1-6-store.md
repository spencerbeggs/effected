---
"@effected/store": patch
---

## Documentation

* `Store.fromMigratorRecord` states the id `0` disagreement correctly: effect/sql's `Migrator` runs a migration with id `0`, while `Store` ids are positive integers, so such a record still dies at `Store.layer`
