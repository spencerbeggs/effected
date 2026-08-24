---
"@effected/lockfiles": minor
---

## Features

`Lockfile.packageByInstanceId` — looks up a `ResolvedPackage` by its instance id, answering `Option.none()` when unmatched. The index is built lazily and cached; when a malformed lockfile repeats an id, the first occurrence wins so the answer is stable regardless of iteration order.
