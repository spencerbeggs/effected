# @effected/semver

Strict SemVer 2.0.0 versions, ranges and comparators as Effect Schema classes — parse, compare, range matching, range algebra, and a version cache service. Pure tier: peers only on `effect`, zero runtime deps, no IO. The kit's DX north star: everything is class-based statics and instance methods, no floating functions.

## Import

```ts
import { Comparator, Range, SemVer, VersionCache, VersionDiff } from "@effected/semver";
```

Single entrypoint; no subpaths.

## Core API

- **`SemVer`** — `Schema.Class` (`major`/`minor`/`patch`/`prerelease`/`build`). Construct with `SemVer.make(...)` or `SemVer.of(1, 2, 3)`, never `new`. `SemVer.parse(str)` returns `Effect<SemVer, InvalidVersionError>`; `SemVer.FromString` is the codec for embedding in other schemas. Dual statics: `compare`, `gt`, `gte`, `lt`, `lte`, `equal`, `neq`, `truncate`; array helpers `sort`/`rsort`/`max`/`min`; grouping `groupBy`/`latestByMajor`/`latestByMinor`. Instances carry a fluent `bump` namespace: `v.bump.major()`, `.minor()`, `.patch()`, `.prerelease(id?)`, `.release()`.
- **`Comparator`** — one operator + version (`>=1.2.3`); `Comparator.parse`, `.FromString`, instance `test(version)`.
- **`Range`** — comparator sets; `Range.parse`, `.FromString`; matching statics `satisfies`/`filter`/`maxSatisfying`/`minSatisfying`; algebra `union`, `intersect` (fails `UnsatisfiableConstraintError`), `isSubset`, `equivalent`, `simplify`; instance `test(version)`/`filter(versions)`.
- **`VersionDiff`** — `VersionDiff.between(a, b)` is the sole diff entry point; there is no `SemVer.diff`.
- **`VersionCache`** — a `Context.Service` with `VersionCache.layer`: `load`/`add`/`remove`, `versions()`/`latest()`/`oldest()`, `filter(range)` (never fails), `resolve(range)`/`resolveString(input)`, `diff(a, b)`/`next(v)`/`prev(v)`.

## Usage

```ts
import { Range, SemVer } from "@effected/semver";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const version = yield* SemVer.parse("1.2.3");
 const next = version.bump.minor();
 const range = yield* Range.parse("^1.0.0");
 return [next.toString(), range.test(version)] as const;
});
// ["1.3.0", true]
```

## Testing machinery

No dedicated test fixtures exported. `VersionCache.layer` is a real, dependency-free layer — provide it directly in tests that exercise cache-driven code.

## Gotchas

- Equality ignores build metadata (spec §10) but includes prerelease identifiers (spec §11); `SemVer` implements both `Equal` and `Hash`, and `VersionCache` dedupe inherits this.
- `Range.isSubset` (and `equivalent`/`simplify`) is a conservative approximation — false negatives are expected, not bugs.
- `Range.test` enforces node-semver's prerelease restriction: a prerelease only matches when some comparator carries a prerelease on the same `major.minor.patch` tuple.
