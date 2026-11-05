---
"@effected/semver": minor
---

## Features

* `VersionSpecifier` (#1210) parses a dependency specifier that is one operator and one complete version (`1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`). It keeps the operator as written and rejects compound ranges, partial versions, wildcards and padded input with `InvalidVersionSpecifierError`, so a caller can rewrite the version without dropping part of a range. `VersionSpecifier.parse`, `parseResult` and the `FromString` codec are available.
