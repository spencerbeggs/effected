---
"@effected/npm": patch
---

## Bug Fixes

* `CatalogAssemblyError.message` now joins nested cause messages, with a guarded read, so the underlying failure is visible.
