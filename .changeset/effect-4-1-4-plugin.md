---
"@effected/plugin": minor
---

## Features

### The carrier bundles the tool

The published `@effected/plugin` now carries the `effected` tool's kit closure and `effect` 4.1.4 inside its own files. Installing it no longer installs `@effected/*` packages or `effect` alongside it. `effect` is an optional peer, needed only for the config types a `schemastore.config.ts` imports.

### The whole schemastore authoring surface from one import

The root entry re-exports everything a `schemastore.config.ts` builds from, so a config imports from `@effected/plugin` and nothing else:

```ts
import { defineSchemastore, HostedSchema, SchemaTarget } from "@effected/plugin";
```

The surface covers `defineSchemastore`, `HostedSchema`, `SchemaTarget`, `SchemaVersion`, `SchemaVersioning`, `DriftPolicy`, `KeywordFamilies`, `CatalogEntry`, `SchemastoreVersion` and their related types. `defineSchemastore` is the only define name. Every value built from here carries the version the tool was built against, so the tool's version check always passes for it.

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | dependency | updated | 4.1.3 | 4.1.4 |
