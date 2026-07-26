---
"@effected/package-json": minor
---

## Features

Added `Repository` and `Bugs` field classes, plus `homepage`, `maintainers`
and `keywords` fields on `Package`. `Repository` round-trips both the
shorthand string form and the object form byte-for-byte, the same wire
fidelity discipline `Person` already carries.

## Bug Fixes

Fixed `Person` silently dropping unknown keys on an object-form `author` /
`contributors` / `maintainers` field. `Person` lacked a `rest` catch-all, so
`{"name":"Dee","twitter":"@dee"}` re-encoded as `{"name":"Dee"}` on a
read-then-write round trip; unknown keys are now preserved and flattened back
on encode. An edited shorthand (e.g. `"Ann <ann@x.dev>"`) now re-emits as a
shorthand rather than silently upgrading to the object form, unless the edit
added keys the shorthand grammar cannot express — in which case the object
form is used so no data is lost.
