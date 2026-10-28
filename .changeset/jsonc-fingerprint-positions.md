---
"@effected/jsonc": minor
---

## Features

* `JsoncCanonicalizeOptions` opts in, per value kind, to lenient fingerprinting: `bigint` as a bare decimal literal, `undefined` omitted (`null` in arrays), non-finite numbers as `null`, and `toJSON` on a `Date` only or on any object. `canonicalizeResult`, `canonicalize`, `hash` and `hashResult` take it as an optional last argument. The strict RFC 8785 default is unchanged (#1121).

## Bug Fixes

* Diagnostic positions come from `@effected/source`, fixing a character of `-1` at the `\n` of a `\r\n`.
