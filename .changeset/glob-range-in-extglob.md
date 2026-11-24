---
"@effected/glob": patch
---

## Bug Fixes

* A numeric range of 100 or more values inside a `!(...)`, `*(...)` or `+(...)` extglob is now expanded, as minimatch 11.0.9 expands it, instead of being matched as one portion. Those extglobs repeat or negate each value, so `*({1..100})` no longer matches `510` (read as `5` then `10`), and `!({1..100})` now matches `5`. A range inside `@(...)` or `?(...)`, or outside any extglob, is unchanged.
