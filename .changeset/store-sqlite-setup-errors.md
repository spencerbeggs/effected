---
"@effected/store": patch
---

## Bug Fixes

- `Store.layerSqlite`, `Store.layerSqliteAs`, `Cache.layerSqlite` and `Cache.layerSqliteAs` now re-raise the SQLite driver's typed setup failures (opening the database, configuring it, switching to WAL) as `StoreError` / `CacheError` with operation `"setup"`. A database whose parent directory does not exist now fails with a typed error instead of dying as a defect. Closes #932.
- The SQLite driver now retries a contended first WAL switch within `busyTimeout`, so the first-open warm-up workaround for concurrent processes is no longer needed.
