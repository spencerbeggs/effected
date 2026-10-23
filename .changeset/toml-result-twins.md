---
"@effected/toml": minor
---

## Features

- Adds the synchronous twins `TomlFormat.modifyResult` and `modifyToStringResult`, `TomlDocument.parseResult` and `TomlDocument#toValueResult`. Each returns a `Result`, and the Effect forms are built from them.
- Every parse path (`Toml`, `TomlDocument` and `TomlVisitor`) maps engine errors the same way.

## Bug Fixes

- `TomlDocument#toValue` and `TomlVisitor.visit` do their work when the effect or stream runs, not when the method is called, so an engine defect dies inside the effect instead of throwing.

## Other

- Tracing: `TomlFormat.modify` no longer opens a nested `TomlDocument.parse` child span, and `modifyToString` no longer opens a nested `modify` span.
