---
"@effected/workspaces": minor
---

## Features

### Parse a pnpm configDependencies spec

`ConfigDependencySpec` models one `configDependencies` value from `pnpm-workspace.yaml`. It reads the bare form pnpm 11 and 12 write (`0.11.1`) and the deprecated inline-integrity form (`0.11.1+sha512-<base64>`). The version is an exact SemVer version. The integrity is an SRI hash, validated by `@effected/npm`'s `SriIntegrityHash` and present only on the inline form.

* `ConfigDependencySpec.parse(spec)` and `parseResult(spec)` fail with `InvalidConfigDependencySpecError`. Its `reason` is `"version"` for a range, dist-tag or partial version, and `"integrity"` for a tail that is not an SRI hash. A corepack `sha512.<hex>` tail counts as `"integrity"`.
* `bare` renders `<version>`, the form to write when normalizing the field.
* `toString()` renders the form that was parsed, so a spec you only read round-trips byte for byte.
* `ConfigDependencySpec.FromString` is the matching string codec.

Only the first `+` separates version from integrity, because an SRI's base64 can itself contain `+`. Hook replay splits specs the same way. It still validates neither half, so it resolves every spec it resolved before.
