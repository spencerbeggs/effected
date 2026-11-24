---
"@effected/changesets": minor
---

## Breaking Changes

- Requires `@effected/markdown` 0.30.0 (`peerDependencies`: `^0.30.0`), a breaking release from 0.29.0. A consumer still on 0.29.0 cannot install this version beside it, so this release leaves its own version line too.
- Requires `@effected/markdown-lint` 0.3.0 (`peerDependencies`: `^0.3.0`), a breaking release from 0.2.0. A consumer still on 0.2.0 cannot install this version beside it, so this release leaves its own version line too.

To upgrade, move `@effected/markdown` to 0.30.0, `@effected/markdown-lint` to 0.3.0 in the same install as this release.
