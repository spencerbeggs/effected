---
"@effected/schemastore": minor
---

## Features

### Widened version grammar

`SchemaVersion` now accepts `major`, `major.minor` and `major.minor.patch` labels (optional prerelease; `+build` metadata is still rejected). Each label round-trips verbatim into its file name and URL, and missing components read as `0` for ordering, so `1`, `1.0` and `1.0.0` compare equal. `SchemaTarget.make` also accepts a plain string `version` and parses it, so a config file no longer needs `SchemaVersioning.parseResult` to build a versioned target.

### `SchemaTarget.published`

A new `published` flag on every target marks whether anyone depends on its label yet. `SchemaTarget.make` accepts it as an optional input and fills it in (default `false`). It is the lifecycle switch the drift policy reads; the pipeline's own `contractChanges: "block-versioned"` guard is unchanged.

### `DriftPolicy`

A pure classifier over a target's `published` flag and `WriteChange`: `classify({ published, change }, policy)` answers `"write"` or `"drift"` under `"semantic"` (a contract change is drift), `"strict"` (annotation changes too) or `"allow"` (nothing is held). `DriftPolicy.defaults` is `{ policy: "semantic", onDrift: "error" }`.

### `defineConfig`

The `schemastore.config.ts` contract for the new `@effected/schemastore-cli` companion. It validates the schema targets, decodes the `catalog` and `drift` blocks, derives each catalog entry's `versions` map from every versioned schema of its name through `CatalogEntry.assemble`, rejects two spellings of one version under one name, rejects an output `path` declared twice across schemas and catalog entries (compared after a lexical normalisation of `./`, `..` and trailing slashes; the CLI's loader re-checks on the resolved absolute paths), and brands the result so `isSchemastoreConfig` recognises a loaded module's default export.

### `CatalogEntry.assemble` duplicate-version guard

`CatalogEntry.assemble` now throws an `Error` naming both spellings when two `versions` labels compare equal under `SchemaVersioning.Order` (`1.2` and `1.2.0`): each would otherwise mint its own `versions` key and URL for one document. `defineConfig` already refused this; the library entry point now does too.

## Breaking Changes

`SchemaTarget.published` is a **required** field on the public `SchemaTarget` interface. Every target built through `SchemaTarget.make` already carries it, but code that constructs a `SchemaTarget` object literal (rather than via `make`) must now add `published: false` (or `true`) to typecheck.

`SchemaVersioning.next(version, "contract")` now suggests a **minor** bump instead of a major one, preserving the label's component count (`1` → `2`, `1.2` → `1.3`, `1.2.0` → `1.3.0`). `DocumentDiff` cannot tell an added optional property from a removed required one, so the suggestion's job is to be strictly greater and conspicuous; bump major by hand when you know a change is breaking. Callers that asserted on the old major suggestion need to update their expectations.
