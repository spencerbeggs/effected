---
"@effected/images": patch
---

## Bug Fixes

Republished with every `effect` and `@effect/*` version pinned exactly to `4.0.2`, both peer and dependency ranges.

On 2026-10-10, every `@effect/*` package published at `4.0.3`, but `effect@4.0.3` itself never reached npm (Effect-TS/effect#8994). The 4.0.3 packages require `effect ^4.0.3`. A caret range on any of them therefore resolves a 4.0.3 package next to `effect@4.0.2`, and the program crashes when it imports them. Exact pins keep a fresh install of any kit package on a matched set until `effect@4.0.3` is available.
