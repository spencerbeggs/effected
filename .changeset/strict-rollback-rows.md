---
"@effected/store": minor
---

## Breaking Changes

Rollback tombstone rows in `_store_meta` are now decoded when read. An unreadable key (not a positive integer of up to 16 digits) or value (not JSON of the form `{ at: string, snapshots: Record<string, string | null> }`) fails as a typed `StoreError` with `operation: "setup"` or `"migrate"`, naming the key and the issue. Previously garbage JSON was a defect and a non-numeric key was silently ignored.

## Bug Fixes

* `StoreError.message` now joins the cause chain (driver summary plus the innermost SQLite text) for every cause, not only `SqlError`.
