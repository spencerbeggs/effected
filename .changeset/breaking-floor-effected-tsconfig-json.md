---
"@effected/tsconfig-json": minor
---

## Breaking Changes

- Requires `@effected/glob` 0.22.0 (`peerDependencies`: `^0.22.0`), a breaking release from 0.21.0. A consumer still on 0.21.0 cannot install this version beside it, so this release leaves its own version line too.

To upgrade, move `@effected/glob` to 0.22.0 in the same install as this release.
