---
"@effected/semver": patch
---

## Documentation

- The dual matching statics on `Range` — `satisfies`, `filter`, `maxSatisfying`, `minSatisfying` — now state their data-first argument order explicitly: the subject comes first, the range second. "Dual API" alone did not say which order the data-first form takes, and the order is not recoverable from the call site when the two parameters are distinct classes.
- `Range.satisfies` additionally documents the failure a flipped call produces. TypeScript rejects it outright, so it only reaches callers without type checking — including untyped runtime probes — where it dispatches data-first and dies with `TypeError: range.test is not a function`, a message naming the parameter that received the version and so reading as a defect inside the package rather than a caller error.
