---
"@effected/package-json": minor
---

## Features

### License validation moves to `@effected/spdx`

`isValidSpdx` and the `License` schema now validate compound SPDX expressions through `@effected/spdx`'s `isValidExpression` instead of the foreign `spdx-expression-parse` runtime dependency, which has been dropped. The `UNLICENSED` and `SEE LICENSE IN` special cases are unchanged, and validation is now a kit-internal boundary — `@effected/package-json` delegates SPDX validity to a sibling package rather than a third-party parser.
