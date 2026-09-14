---
"@effected/schemastore": minor
---

## Features

### Widened version grammar

`SchemaVersion` now accepts `major`, `major.minor` and `major.minor.patch` labels (optional prerelease; `+build` metadata is still rejected). Each label round-trips verbatim into its file name and URL, and missing components read as `0` for ordering, so `1`, `1.0` and `1.0.0` compare equal. `SchemaTarget.make` also accepts a plain string `version` and parses it, so a config file no longer needs `SchemaVersioning.parseResult` to build a versioned target.

### `SchemaTarget.published`

A new optional `published` flag (default `false`) on every target marks whether anyone depends on its label yet. It is the lifecycle switch the drift policy reads; the pipeline's own `contractChanges: "block-versioned"` guard is unchanged.

### `DriftPolicy`

A pure classifier over a target's `published` flag and `WriteChange`: `classify({ published, change }, policy)` answers `"write"` or `"drift"` under `"semantic"` (a contract change is drift), `"strict"` (annotation changes too) or `"allow"` (nothing is held). `DriftPolicy.defaults` is `{ policy: "semantic", onDrift: "error" }`.

### `defineConfig`

The `schemastore.config.ts` contract for the new `@effected/schemastore-cli` companion. It validates the schema targets, decodes the `catalog` and `drift` blocks, derives each catalog entry's `versions` map from every versioned schema of its name through `CatalogEntry.assemble`, rejects two spellings of one version under one name, and brands the result so `isSchemastoreConfig` recognises a loaded module's default export.

## Breaking Changes

`SchemaVersioning.next(version, "contract")` now suggests a **minor** bump instead of a major one, preserving the label's component count (`1` → `2`, `1.2` → `1.3`, `1.2.0` → `1.3.0`). `DocumentDiff` cannot tell an added optional property from a removed required one, so the suggestion's job is to be strictly greater and conspicuous; bump major by hand when you know a change is breaking. Callers that asserted on the old major suggestion need to update their expectations.
