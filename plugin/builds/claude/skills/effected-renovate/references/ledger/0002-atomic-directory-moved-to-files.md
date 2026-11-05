---
id: "0002"
title: "AtomicDirectory, AtomicDirectoryError and AtomicDirectoryFiles moved from @effected/store to @effected/files"
kind: breaking
shows: typed
applies:
  "@effected/store": ">=0.24.0"
detect: ["AtomicDirectory(Error|Files)?"]
---

`AtomicDirectory`, `AtomicDirectoryError` and the `AtomicDirectoryFiles` type are no longer exported from `@effected/store`. They live in the new `@effected/files` package, with no re-export and no shim, so a stale import fails at build.

1. **Add `@effected/files`** to the package that imports them, through `catalog:effected`, and add it to the same install as the store bump.
2. **Re-point each import** from `@effected/store` to `@effected/files`. The names are unchanged; check the installed `.d.ts` for the exact exports.
3. **Look in tests too.** A test that builds a directory fixture through the store import needs the same change.

`@effected/files` also ships `AtomicFile.write`, which replaces a single file with the same guarantees; see the adoption entry for it.
