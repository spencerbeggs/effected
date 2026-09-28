---
"@effected/schemastore": minor
---

## Breaking Changes

`defineConfig` now requires `name`, and `catalogPath` is removed in favour of `catalogDir`.

* `name` is the simple file base name of this config's catalog slice. A config without one fails with a message explaining what to add.
* Configs that share a `catalogDir` must have `name`s that differ case-insensitively.
* `catalogDir` (default `<outputDir>/catalogs`) replaces `catalogPath`. Each config writes its own slice to `<catalogDir>/<name>.json`.
* `catalogDir` may not equal the merged catalog's path, `outputDir`, or contain any config's output documents, because every `*.json` file in it is read as a slice.

Migration: add a `name` to each config and rename or remove `catalogPath`.

```ts
export default defineConfig({
  name: "my-tool",
  outputDir: "schemas",
  // catalogDir defaults to "schemas/catalogs"; the merged catalog.json
  // lands at "schemas/catalog.json", the same URL as before
  schemas: {
    // ...
  },
});
```

## Documentation

* README describes the slice-and-merge catalog layout and the new `name` and `catalogDir` options.
