---
"@effected/yaml": minor
---

## Breaking Changes

### Unrepresentable values fail instead of stringifying

`Yaml.stringify`, `stringifyResult`, the schema encoders, `YamlDocument.stringify`/`stringifyResult` and `YamlFormat.modify` now fail with code `UnrepresentableValue` (`YamlStringifyError` or `YamlModificationError`) on a function or symbol, or on a synthetic `YamlScalar` holding anything other than null, boolean, number, bigint or string. They previously wrote `String(value)` as a quoted scalar.

`YAML_STRINGIFY_ERROR_CODES`, `YAML_MODIFY_ERROR_CODES` and their code types gain `"UnrepresentableValue"`, so the `YamlErrorCode` union gains a member; exhaustive switches must add a case.

### Other behaviour changes

* A synthetic `YamlScalar` with a bigint value renders bare (preferring `node.raw`) rather than quoted; `YamlFormat.modify` now matches `Yaml.stringify`.
* A cyclic hand-built AST fails with `CircularReference` on first re-entry, not `NestingDepthExceeded` after the depth cap.

## Bug Fixes

* Parsed hex and octal integers beyond `MAX_SAFE_INTEGER` keep their raw spelling on round-trip.
