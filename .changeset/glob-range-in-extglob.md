---
"@effected/glob": patch
---

## Bug Fixes

* A numeric range of 100 or more values inside a `!(...)`, `*(...)` or `+(...)` extglob is now expanded, as minimatch 11.0.9 expands it, instead of being matched as one portion. Those extglobs repeat or negate each value, so `*({1..100})` no longer matches `510` (read as `5` then `10`), and `x!({1..100})` now matches `x5`. A range inside `@(...)` or `?(...)`, or outside any extglob, is unchanged.
* Because such a range is now expanded, the brace-expansion budget applies to it: `*({0..200000})`, which compiled before, now fails at compile with `ExpansionBudgetExceeded`, where minimatch truncates it at 100,000 values. A range of up to 100,000 values (`+({0..99999})`) still compiles.
