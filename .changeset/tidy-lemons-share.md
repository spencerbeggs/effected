---
"@effected/schemastore-cli": minor
---

## Features

The package now has a library entry beside its `bin`: `AjvValidator.layer`, the shipped ajv strict-mode `SchemaValidator` engine (declared keyword families and the standard `ajv-formats` vocabulary registered, a fresh instance per call), moved here from `@effected/schemastore` together with the `ajv` / `ajv-formats` dependencies. The command composes it at its edge; it is exported for a program that drives `SchemaPipeline` itself and wants the same verdict.

Pre-flight now reads each frozen file and verifies its `$id`: a run fails with `FrozenVersionIdMismatchError` when a frozen file's `$id` is absent, differs from the derived one, or the file's text does not parse. A `baseUrl` change on a hosted schema is a re-publish event for every frozen label it affects, and this catches it before a stale file ships.

`check` and `build` now report an `orphaned` catalog: when no schema declares a `catalog` but a file already exists at `config.catalogPath`, `check` reports it stale (exit 1) and `build` reports it without deleting it.

`ConfigLoader` now requires `frozen[].$id` on a loaded config — a config built by an older `@effected/schemastore` is rejected as malformed rather than silently accepted.
