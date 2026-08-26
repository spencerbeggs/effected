---
"@effected/spdx": minor
---

## Features

### `License` catalog metadata

`License` gains four derived getters, backed by a new generated vendored
dataset:

- `referenceUrl` — the canonical SPDX web page (`Option`, `none` for a
  `LicenseRef`/`DocumentRef`)
- `name` — the license's full title, e.g. `"MIT License"` for `MIT`
  (`Option`, `none` for a `LicenseRef`/`DocumentRef`)
- `osiApproved` — whether the OSI has approved the license
- `fsfLibre` — whether the FSF lists the license as libre

Schema fields are unchanged, so encoded shape and structural equality are
untouched.

### `SpdxExpression` license reads

- `primaryLicense` — the single license an expression can be said to be
  under, when there is one. Deliberately `Option.none()` for an `AND`
  expression — a conjunction has no single license, and picking one would
  silently drop a term that legally applies.
- `licensesOf` — every license an expression names, in written order,
  de-duplicated by identifier.

```ts
import { SpdxExpression } from "@effected/spdx";

// "(MIT OR Apache-2.0)"  => Option.some(License("MIT"))
// "(MIT AND Apache-2.0)" => Option.none()
```
