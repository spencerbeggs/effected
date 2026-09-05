---
"@effected/semver": patch
---

## Bug Fixes

- `SemVer.bump.major()` / `minor()` / `patch()` / `prerelease()` now throw an invariant error naming the component and `Number.MAX_SAFE_INTEGER` when a bump cannot be represented, instead of a raw schema-validation defect.

## Documentation

- `SemVerBump` documents that `bump` is an instance getter and that a MAJOR, MINOR or PATCH bump over a prerelease increments past it (`2.0.0-beta.1` → `3.0.0`), diverging deliberately from node-semver.
