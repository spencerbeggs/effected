---
"@effected/semver": minor
---

## Breaking Changes

### `SemVerBump.prerelease()` increments the right-most numeric identifier

`1.0.0-1.beta` now bumps to `1.0.0-2.beta` (previously `1.0.0-1.beta.0`). A `.0` is appended only when no identifier is numeric.

### `Range` carries `includePrerelease`

The `Range` schema gains `includePrerelease: boolean`, defaulting to `false` in the constructor and when decoding. `Schema.encode(Range)` output now includes the key, and `Equal`/`Hash` take it into account. `Range.FromString` cannot round-trip the flag.

## Features

* New `RangeOptions { includePrerelease?: boolean }`, accepted by `Range.parse(input, options?)`, `Range.parseResult(input, options?)` and `VersionCacheShape.resolveString(input, options?)`.
* With `includePrerelease: true`, partial and wildcard floors desugar to `-0` (`^1.2` becomes `>=1.2.0-0 <2.0.0-0`; `*` becomes `>=0.0.0-0`), and `test`, `filter`, `satisfies`, `maxSatisfying`, `minSatisfying` and version-cache lookups drop the same-tuple prerelease rule. Default behaviour is unchanged.
* `Range.union`, `intersect` and `simplify` propagate `self.includePrerelease`; `Range.isSubset(sub, sup)` is `false` when `sub` includes prereleases and `sup` does not.
