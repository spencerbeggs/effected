---
"@effected/tsconfig-json": minor
---

## Breaking Changes

- Requires `@effected/walker` 0.31.0 (`peerDependencies`: `^0.31.0`), a breaking release from 0.30.0. A consumer still on 0.30.0 cannot install this version beside it, so this release leaves its own version line too.

To upgrade, move `@effected/walker` to 0.31.0 in the same install as this release.
