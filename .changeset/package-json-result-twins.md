---
"@effected/package-json": minor
---

## Breaking Changes

### `PackageJsonModifyError` covers serialization failures

`PackageJsonModifyError` now also wraps serialization failures. A `bigint`, circular, function or symbol value fails with a `JsoncStringifyError` cause instead of dying. When a navigation failure and a serialization failure both apply, the navigation cause wins.

The messages of `PackageJsonSyntaxError` (invalid JSON) and `PackageJsonModifyError` now end with the cause's message, so the JSON position is kept. Code that matches the exact message text must be updated.

## Features

- `PackageJsonFormat.parseObjectResult` and `parseObject` turn manifest text into a plain object and report invalid JSON separately from JSON that is not an object.
- `PackageJsonFormat.modifyResult` and `modifyToStringResult` are synchronous twins of `modify` and `modifyToString`, which are now built from them and keep the same spans.
- `PackageManagerRange` and `Dependency.range` accept ranges with whitespace after the operator, following `@effected/semver`.
