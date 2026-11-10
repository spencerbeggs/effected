---
"@effected/semver": minor
---

## Features

### node-semver's view of a range

A `Range` is normalised for the range algebra: each comparator set is sorted, and it keeps the `>=0.0.0` floor that `*` desugars to. node-semver does neither, so a tool that reproduces it, such as one that rewrites dependency ranges the way a release tool does, could not read node-semver's answers off a `Range`. Two additions give them directly, and the normalised surface is unchanged.

* `Range.writtenSetsResult(input, options?)` returns the comparator sets as node-semver's `Range#set` holds them. `Range.writtenSets` is the `Effect` form, with a `Range.writtenSets` span. Both fail `InvalidRangeError`.
  * Each set's comparators are kept in the order they were written, and a duplicate keeps its first position.
  * The any-version floor, `>=0.0.0` (or `>=0.0.0-0` with `includePrerelease`), is dropped, so an any-version set is empty.
  * A set holding `<0.0.0-0` is just that comparator. Beside another set, a set that admits nothing is dropped, and an any-version set stands for the whole range.
* `range.isAny()` is node-semver's `new Range(input).range === ""`: `*`, `x`, `""`, `>=0.0.0` and `^1.0.0 || *` are any-version ranges, and `* <2.0.0` is not. It does not mean a prerelease satisfies the range: `*` still rejects `1.0.0-beta` under the default rule.
* Under `includePrerelease`, `Range.writtenSetsResult` writes a full hyphen upper bound such as `1.2.3 - 2.3.4` as `<=2.3.4`, as Effect core's `SemVerRange` expands it, where node-semver writes `<2.3.5-0`. No version lies between the two, so both match the same versions.

### An empty `||` part matches every version

`Range.parse` and `Range.FromString` now accept an empty part beside `||` (`||*`, `^1.0.0 ||`, `1.0.0 || || 2.0.0`, a bare `||`), and read it as `*`, as node-semver does. These inputs failed `InvalidRangeError` before. Effect core's `SemVerRange` still rejects them: with build metadata in a range, they are the inputs the kit accepts and core refuses.
