---
"@effected/schemastore": minor
---

## Features

`SchemaTarget` gained an optional `jsonSchema` field, forwarded through `SchemaPipeline.run` and `SchemaPipeline.check` to `StoreDocument.fromSchema`. It carries `Schema.ToJsonSchemaOptions` per target, so a document's generation contract is self-describing regardless of core's own default.

This closes a regression: since `effect` 4.0.0-rc.113, `Schema.toJsonSchemaDocument` emits open objects by default. A previously published closed-object document could no longer be regenerated unchanged — every struct flipped `additionalProperties: false` to `true`, which the pipeline classified as a contract change and refused to rewrite a pinned version in place.

```ts
const target = SchemaTarget.make({
	schema: MySchema,
	$id: "https://example.com/schemas/my-schema.json",
	path: "schemas/my-schema.json",
	jsonSchema: { onExcessProperty: "error" },
});
```

Passing `onExcessProperty: "error"` on the target reproduces the closed document deterministically.
