---
"@effected/semver": minor
---

## Features

### Exact-version string schemas

Two new `Schema.String`-typed refinements for consumer structs whose field must stay a plain string while still refusing anything that is not exactly one version:

* `SemVer.ExactVersionString` — a valid SemVer 2.0.0 version, exactly as given (build metadata allowed).
* `SemVer.PinnableVersionString` — the same, but rejects build metadata too: the notion a `<name>@<version>[+<integrity>]` pin grammar needs, since the first `+` after the version always begins the integrity component.

Both stay typed as `string`; decode through `SemVer.FromString` instead when the parsed components are wanted.

### Validity predicates

* `SemVer.isValid(input)` — `true` when `input` is a valid version string with **no** surrounding whitespace. `SemVer.parse`/`parseResult` continue to trim, matching node-semver's constructor; this predicate answers the stricter question "is this string, byte for byte, a version?"
* `SemVer.isPinnable(input)` — `true` when `input` is valid by `isValid` **and** carries no build metadata.

```ts
import { SemVer } from "@effected/semver";

SemVer.isValid(" 1.2.3"); // false — parse() would trim and accept it
SemVer.isPinnable("1.2.3+build"); // false — build metadata present
```
