---
"@effected/schemastore": minor
---

## Breaking Changes

### `defineConfig` schemas are now keyed, and every URL is derived

`SchemastoreConfigInput.schemas` is now a record keyed by file base name instead of an array — the key IS the schema's `name`, and every derived path and URL (`$id`, the write path, the catalog `url`) comes from that name plus `outputDir`, `baseUrl` and `layout`. Nothing is spelled out by hand anymore, so a document's identity can never disagree with where it's written.

```ts
import { defineConfig } from "@effected/schemastore";

export default defineConfig({
  outputDir: "schemas",
  schemas: {
    "my-schema": {
      schema: MySchema,
      baseUrl: "schemastore",
      catalog: {
        description: "My schema",
        fileMatch: ["my-schema.json"],
      },
    },
  },
});
```

`baseUrl: "schemastore"` expands to `json.schemastore.org` for `$id` and `www.schemastore.org` for the catalog `url`, and forces the flat layout. Any other `baseUrl` must be an `https://` URL, used as one base for both, defaulting to the `"versioned"` layout (`schemas/<version>/<name>-<version>.json`).

Versioning moves from a separate `CatalogConfig`/`CatalogTarget` shape onto each schema entry: `versions` lists every label a schema advertises, and `current` (default: the newest) is the one generated now — every other label becomes a frozen file the CLI verifies but never regenerates. `CatalogConfig` and `CatalogTarget` are removed; a catalog entry is now declared per schema via `catalog: { description, fileMatch }` and assembled from the same derived identity.

Top-level `drift`/`onDrift` defaults live on the config, with a per-entry `drift` override; both flow to the CLI's drift table unchanged in meaning.

New exports support this: `SCHEMASTORE_ID_BASE`, `SCHEMASTORE_CATALOG_BASE`, `CatalogInput`, `SchemaEntryInput`, `FrozenVersion`, `ResolvedSchema`, and `SchemaLayout`. `SchemaVersioning.fileName`/`schemaUrl`/`catalogUrls` and `CatalogEntry.assemble` accept the new `layout` and `current` parameters (existing calls are unaffected — both default to the previous behavior).

There is no migration shim: every repository consuming this package's previous config shape must rewrite its `schemastore.config.ts` to the keyed form above.
