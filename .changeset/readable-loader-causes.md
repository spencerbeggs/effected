---
"@effected/schemastore-cli": patch
---

## Bug Fixes

* `ConfigLoader` import-failure messages read `stack` defensively, then the cause-chain message, then `String(cause)`. Only non-`Error` and cross-realm causes render differently.
