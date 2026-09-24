---
"@effected/schemastore": patch
---

## Documentation

- The `StoreDocumentOptions.jsonSchema` API docs now state current behaviour without Effect version history: a published document's objects are closed (`onExcessProperty: "error"`) where core's own default is `"ignore"`, and `{ onExcessProperty: "ignore" }` reopens them.
