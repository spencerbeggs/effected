---
"@effected/sbom": minor
---

## Features

`Package`, `Person` and `Repository` are now re-exported from
`@effected/sbom`'s entry point, sourced from `@effected/package-json`. A
caller can name `SbomMetadataSource.fromPackage`'s parameter type without
adding `@effected/package-json` as an undeclared dependency:

```ts
import { Package, SbomMetadataSource } from "@effected/sbom";

const supplier = (pkg: Package) => SbomMetadataSource.fromPackage(pkg);
```

`SbomMetadataSource.fromPackage`'s remarks now name `@effected/package-json`
as the source of the `Package` type it accepts.
