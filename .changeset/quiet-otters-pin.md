---
"@effected/npm": minor
---

## Features

### `sha224` recognized as a valid integrity algorithm

`IntegrityAlgorithm` and `IntegrityHash`'s corepack-form regex now accept `sha224`, matching corepack's own transparent default pins (e.g. `yarn@4.x+sha224.<hex>`). The SRI form is unaffected — the SRI specification itself never includes `sha224`.

### `CorepackIntegrityHash`

`IntegrityHash` narrowed to the corepack `<algo>.<hex>` form only — an SRI (`sha512-<base64>`) or yarn (`10c0/<hex>`) hash, both otherwise-valid `IntegrityHash` values, fails this schema. It decodes to the same brand `IntegrityHash` does, so a corepack-validated value assigns anywhere an `IntegrityHash` is expected.

```ts
import { CorepackIntegrityHash } from "@effected/npm";
import { Schema } from "effect";

const decode = Schema.decodeUnknownExit(CorepackIntegrityHash);

decode("sha512.deadbeef"); // success
decode("sha512-3q2+7w=="); // failure — SRI form
```

### `PackageManagerPin`

A new schema for the corepack pin grammar itself — `<name>@<version>[+<integrity>]`, closed to the four package managers the kit can provision (`npm`, `pnpm`, `yarn`, `bun`) via `PackageManagerPinName`. Consumed by `@effected/github-actions`' `PackageManagerInstaller` to provision an exact package-manager version on a runner, and shares its version and integrity schemas with `@effected/package-json`'s `PackageManager` field model.
