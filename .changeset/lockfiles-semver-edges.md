---
"@effected/lockfiles": patch
---

## Bug Fixes

- `LockfileIntegrity` now judges constraint rows written with whitespace after the operator (such as `>= 18`), which it used to skip. A lockfile can report new unsatisfied rows and `valid: false` as a result.
- A `>*` or `<*` constraint now matches nothing, so `LockfileIntegrity` flags every candidate under it.
