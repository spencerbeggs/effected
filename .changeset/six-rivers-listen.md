---
"@effected/package-json": minor
---

## Features

### Decode-free canonical sort and format: `PackageJsonFormat`

```ts
import { PackageJsonFormat } from "@effected/package-json";

PackageJsonFormat.sortValue({ version: "1.0.0", name: "p" });
// => { name: "p", version: "1.0.0" }

const formatted = PackageJsonFormat.formatToString('{"private": true}');
```

Two new entry points offer the same canonical key ordering as the strict validating path, without decoding into a `Package`: `PackageJsonFormat.sortValue` is value→value, total, and returns its input's own type `T`; `PackageJsonFormat.formatToString` is string→string, returning a `Result<string, PackageJsonSyntaxError>` for hosts that hold raw file text. New `PackageFormatTextOptions` controls indentation, sorting, empty-map stripping and the trailing newline for the text path.

They are statics on a `PackageJsonFormat` class rather than floating functions, and `formatToString` is the name `@effected/jsonc`, `@effected/yaml` and `@effected/toml` already use for the same bytes→bytes shape, so a consumer who has met one kit formatter has met all four.

Because nothing is decoded, nothing is normalized: the value path only ever reorders keys — it never adds or removes one, which is what lets `sortValue`'s return type equal its input type. The existing strict `Package.decode` / `Package.toJsonString` path is unchanged.

## Bug Fixes

### Object-form `Person` values no longer drop unknown keys

An object-form `author`, `contributors` or `maintainers` entry silently lost any key it didn't recognize: `{"name":"Dee","twitter":"@dee"}` re-encoded as `{"name":"Dee"}`. This is data loss on any manifest with a non-standard person key, and it is present in the released `0.3.1`.

`Person` now carries a `rest` catch-all that preserves unrecognized keys verbatim, replaying them — including their original key order — on encode. Also fixed: a string-form author shorthand (`"Name <email>"`) was being rewritten to the object form on a round trip instead of being preserved as a string.
