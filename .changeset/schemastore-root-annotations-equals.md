---
"@effected/schemastore": minor
---

## Features

`StoreDocument.fromSchema` accepts a `rootAnnotations` option (also forwarded through `SchemaTarget`'s builders): annotations merged onto the emitted document's root after assembly, for a generator-side annotation loss the source schema cannot express.

```ts
StoreDocument.fromSchema(schema, {
	$id: "https://example.com/foo.json",
	rootAnnotations: { title: "Foo", description: "…" },
});
```

Admitted keys are the standard JSON Schema annotation keywords (`title`, `description`, `$comment`, `default`, `examples`, `readOnly`, `writeOnly`, `contentMediaType`, `contentEncoding`) plus the declared keyword families — any other key fails the build with `UndeclaredAnnotationKeyError`, checked up front before anything is generated. When the assembled root is a bare local `$ref` (the shape a `Schema.Class` root produces), the annotations are merged onto the `$defs` entry it names instead, since Draft-07 validators ignore `$ref` siblings. When that entry is shared with other references (a recursive class, for instance), the root is instead rewritten to `{ ...annotations, allOf: [{ $ref }] }` so the document is annotated without every occurrence of the type inheriting its title.

`CanonicalJson.equals(left, right)` is now exported: content equality under the serializer's own semantics (object key order ignored, array order preserved, total against cyclic or hostile-depth input). It is the same comparison `DocumentDiff`'s leaf checks and a catalog write-if-changed decision already make, exposed for a consumer that writes its own JSON artifact and wants to decide "unchanged" by the same rule.

## Bug Fixes

- `defineConfig` throws a clear "invalid catalog: expected an array of catalog entries" error when a config's `catalog` field is not an array, instead of failing later with an opaque `.map is not a function` — and its per-entry error label no longer stringifies a non-object entry as `"undefined"`.
