---
"@effected/plugin": patch
---

## Bug Fixes

* Fixed `effected schema build` and `effected schema check` splitting a reused `identifier` into `X`, `X_1` and `X_2` `$defs` when run through the bundled carrier, for example behind `Schema.withDecodingDefaultKey` annotated at several sites. Published schemas reported false contract drift because the installed `@effected/schemastore` emitted a single definition. The output now matches `StoreDocument.fromSchemaResult` from the consumer's own `@effected/schemastore` (closes #1348).
