---
"@effected/schemastore": minor
---

## Features

* `SchemastoreVersion` and version stamps record which tool version produced a generated schema.
* `PipelineCheckResult` and the result of `SchemaFile.check` now report `generated` and `existing` so a caller can show what drifted.
* `ResolvedSchema.hosted` exposes the hosted form of a resolved schema, and `hosted` is recognized by brand across duplicate package copies.
* The `@effected/semver` dependency is now an exact version, so the installed `@effected/schemastore` and `@effected/semver` always agree.
