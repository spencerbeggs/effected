---
"@effected/package-json": patch
---

## Bug Fixes

* `PackageManager.FromString` now fails typed, instead of silently accepting a malformed value as a raw string, when the trailing integrity segment cannot be validated as an `@effected/npm` `IntegrityHash`.

## Refactoring

* `Dependency.kind` and `PackageManager.integrity` now type against `@effected/npm`'s consolidated `DependencyKind`/`IntegrityHash` vocabulary.
* `DependencySpecifier` is now re-exported from `@effected/npm` rather than defined locally. The public surface is unchanged — only its source module moved.
