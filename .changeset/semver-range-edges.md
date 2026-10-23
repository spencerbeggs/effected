---
"@effected/semver": minor
---

## Breaking Changes

Range edges now follow node-semver and Effect core. Most of these changes keep the same types but alter what a range matches, so review any stored constraint that uses a wildcard, an operator with a space after it, or build metadata.

### Wildcard caret, tilde and comparison ranges

- `^*`, `~*`, `^x` and `~x.x` now match every release. They used to mean `>=0.0.0 <1.0.0-0` and reject `1.0.0`, so a constraint written this way now admits 1.x and later. `@effected/runtimes` resolves such a constraint to the latest version instead of stopping below `1.0.0`.
- `>*` and `<*` (and `>x`, `<x.x`) now match nothing. They used to match every release. `Range.intersect` with such a range fails with `UnsatisfiableConstraintError`, `isSubset(>*, anything)` is true, and `Range.simplify` drops the empty set when another set remains.
- A hyphen range with a `*` side drops that side's comparator, so `* - 2` is now `<3.0.0-0`. `Range.toString` output changes for these ranges.
- A wildcard beside other comparators in the same set contributes no bound, so `* <=0.0.0-1` and `^* >=0.0.0-0` now match `0.0.0-0`. A bare `*` is still `>=0.0.0` and still rejects prereleases. `Range.toString` drops the wildcard from such a set.
- `<1.x` and `<1.2.x` now desugar to `<1.0.0-0` and `<1.2.0-0`, so `>=1.0.0-alpha <1.x` no longer matches `1.0.0-beta`.

### Parsing

- Any whitespace now separates comparators, `||` and hyphen ranges, and whitespace may follow an operator in both `Range` and `Comparator` (`>= 18`, `^ 1.2.3`). Constraints that used to fail to parse now parse. As a result, `@effected/workspaces` `PeerCheck` and `@effected/lockfiles` `LockfileIntegrity` now judge rows they used to skip, `@effected/npm` `DependencySpecifier` classifies `>= x` as a range, and `@effected/package-json` accepts more ranges.
- A concrete component after a wildcard (`1.*.3`, `x.1.2`, `*.1`) now fails with `InvalidRangeError`, which carries the position. It used to be accepted.
- Build metadata is dropped when `Range` and `Comparator` parse, and `formatComparator` never prints it, so `Comparator.FromString` no longer round-trips build metadata.

### Prerelease bumps

`SemVerBump.prerelease(id)` reads an all-digit identifier as a number: `1.2.3-1.0` bumped with `1` gives `1.2.3-1.1` (it used to throw), and `1.2.3` bumped with `1` gives `1.2.4-1.0`. A malformed identifier (empty, `a.b`, `01`, or an unsafe integer) throws an `Error` that names it.

### Migration

Search stored constraints for `^*`, `~*`, `>*` and `<*` and rewrite any whose new meaning you do not want. Replace a range that puts a concrete component after a wildcard with the equivalent range written without it.

## Bug Fixes

- `Range.simplify` keeps every distinct set when some sets are subsets of each other. `^1 || ^1 || ^2` used to simplify to `>=2.0.0 <3.0.0-0` and lose `^1`; it now keeps both.
