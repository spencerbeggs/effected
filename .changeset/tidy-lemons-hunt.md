---
"@effected/schemastore": minor
---

## Features

### HostedSchema

New `HostedSchema` derives an application's `$schema` URL and `defineConfig`'s `$id` from one value, so the URL your code emits and the `$id` the CLI writes can never disagree.

```ts
import { HostedSchema } from "@effected/schemastore";

export const OutputSchema = HostedSchema.github({
  repo: "savvy-web/silk-release-action",
  path: "schemas",
  name: "silk-release-action.output",
  versions: ["5.2"],
});

OutputSchema.$id; // the current document's $id
OutputSchema.url; // its catalog URL
```

Three constructors cover every hosting shape: `HostedSchema.github({ repo, branch?, path?, name, versions?, current?, layout? })`, `HostedSchema.schemastore({ name, versions?, current? })` for documents published to SchemaStore itself, and `HostedSchema.custom({ baseUrl, name, versions?, current?, layout? })` for any other `https://` directory. Each validates the identity and throws a descriptive `Error` when it does not resolve — an unversioned `current`, a duplicate version label, or a `name` that is not a simple file base name.

`defineConfig`'s schema entries accept an optional `hosted` field carrying one of these values; when set, it owns `baseUrl`, `versions`, `current` and `layout` for that entry, and spelling those keys beside `hosted` is rejected.

`SCHEMASTORE_ID_BASE` and `SCHEMASTORE_CATALOG_BASE` now live in this module (still re-exported from the package root, so no import changes).

## Breaking Changes

`StoreDocument.fromSchema` now generates every object with `onExcessProperty: "error"` by default, emitting `additionalProperties: false` throughout. Previously it followed core's open default. A published document that was generated open now reads as a contract change on the next build; pass `jsonSchema: { onExcessProperty: "ignore" }` on that target to keep the prior shape.

`defineConfig`'s input is now decoded with `Schema.Struct`: an unknown key is rejected by name instead of silently ignored (a typo like `versons` now fails), every issue on an entry is reported at once, and rejection messages read as `defineConfig: schema "<name>" Expected string at ["baseUrl"]` rather than the previous phrasing.
