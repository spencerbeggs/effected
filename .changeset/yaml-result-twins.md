---
"@effected/yaml": minor
---

## Features

- Adds the synchronous twins `YamlFormat.modifyResult` and `modifyToStringResult`, `YamlDocument.parseResult` and `parseAllResult`, and `YamlDocument#stringifyResult`. Each returns a `Result`, and the Effect forms are built from them.

## Bug Fixes

- `YamlFormat.modify` counts a replacement value's depth from the target's path. A value that used to die with an untyped `StringifyDepthExceeded` one or more keys down now fails typed with `NestingDepthExceeded`.
- `YamlDocument#stringify` does its work when the effect runs, inside a new `YamlDocument.stringify` span, instead of when the method is called.

## Other

- Tracing: `modifyToString` no longer opens a nested `YamlFormat.modify` child span.
