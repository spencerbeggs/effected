---
"@effected/workspaces": patch
---

## Performance

`VersioningStrategy.detect` now runs independent publishability checks with bounded concurrency (`10`) instead of serially probing one package at a time.

- Classification output, tag semantics, and public API are unchanged; only probe scheduling changed.
