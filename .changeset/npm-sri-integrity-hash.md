---
"@effected/npm": minor
---

## Features

### Validate SRI integrity hashes with SriIntegrityHash

`SriIntegrityHash` is `IntegrityHash` narrowed to the SRI `<algo>-<base64>` form: the form lockfiles record, and the form pnpm's legacy inline `configDependencies` integrity carries. A corepack `sha512.<hex>` or yarn `10c0/<hex>` hash fails it. It decodes to the same `IntegrityHashBrand`, so a value it accepts can go anywhere an `IntegrityHash` is expected. It joins `CorepackIntegrityHash`, the existing narrowing to the corepack form.

`SriIntegrityHash` checks only the SRI shape. It doesn't decode or length-check the digest, so a value it accepts can still fail `CorepackIntegrityHash.fromSri`.

### Render a PackageManagerPin without its integrity

`PackageManagerPin.bare` renders `<name>@<version>` and leaves off any integrity: the bare form pnpm writes to the `packageManager` field.
