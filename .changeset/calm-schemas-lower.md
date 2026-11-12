---
"@effected/schemastore": minor
---

## Features

### Lower with the generator of the `effect` copy that built the schema

`StoreDocumentOptions` and `SchemaPipelineOptions` take a new optional `toJsonSchemaDocument` field. It is the generator `StoreDocument.fromSchema` lowers with, and it defaults to this package's own `Schema.toJsonSchemaDocument`.

Pass the generator of the `effect` copy that built the schema when that is not the copy schemastore imports. Core recognises a reused schema's annotated copies through state local to the copy that made them, so a foreign copy's generator split one `identifier` into `X`, `X_1` and `X_2` definitions. A caller that shares one `effect` with its schemas never needs the option.
