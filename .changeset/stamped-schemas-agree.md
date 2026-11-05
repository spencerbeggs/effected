---
"@effected/schemastore": minor
---

## Features

* `SchemastoreVersion` reads the `@effected/schemastore` version stamped on a `defineConfig` result and on `HostedSchema` values, so a tool can tell when a config's values came from a different copy of the package than its own.
* `PipelineCheckResult` and the result of `SchemaFile.check` now report `generated` and `existing` so a caller can show what drifted.
* `ResolvedSchema.hosted` exposes the hosted form of a resolved schema, and `hosted` is recognized by brand across duplicate package copies.
* The `@effected/semver` dependency is now an exact version, so the installed `@effected/schemastore` and `@effected/semver` always agree.
