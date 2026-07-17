# @effected/semver

Strict SemVer 2.0.0 versions, ranges and comparators as Effect Schema classes — parse, compare, range matching, range algebra, and a version cache service. Pure tier: peers only on `effect`, zero runtime deps, no IO. The kit's DX north star: everything is class-based statics and instance methods, no floating functions.

## Import

```ts
import { Comparator, Range, SemVer, VersionCache, VersionDiff } from "@effected/semver";
```

Single entrypoint; no subpaths.

## Feature surface

| Reach for | When |
| --- | --- |
| `SemVer.parse` / `.FromString` | turn a version string into a validated `SemVer` (or embed one in another schema) |
| `SemVer.compare` / `.gt` / `.gte` / `.lt` / `.lte` / `.equal` / `.neq` | dual-API precedence comparisons |
| `v.bump.major()` / `.minor()` / `.patch()` / `.prerelease(id?)` / `.release()` | immutable version bumping |
| `SemVer.sort` / `.rsort` / `.max` / `.min` | array-level precedence operations |
| `SemVer.groupBy` / `.latestByMajor` / `.latestByMinor` | bucket a version list by major/minor/patch key |
| `SemVer.Order` / `.OrderWithBuild` | plug into core `Array.sort`/`Order` combinators instead of hand-rolling a comparator |
| `Comparator.parse` / `.test(version)` | one operator + version constraint |
| `Range.parse` / `.test(version)` / `.satisfies` / `.filter` | range matching |
| `Range.union` / `.intersect` / `.isSubset` / `.equivalent` / `.simplify` | range algebra |
| `VersionDiff.between(a, b)` | classify the change between two versions with signed deltas |
| `VersionCache` | stateful load/query/resolve/navigate over a version set |

## Core API

- **`SemVer`** — `Schema.Class` (`major`/`minor`/`patch`/`prerelease`/`build`), validated in-schema so `SemVer.make(...)` can only produce valid versions; `SemVer.of(1, 2, 3, prerelease?, build?)` is the positional convenience constructor. `SemVer.parse(str)` → `Effect<SemVer, InvalidVersionError>` (no `v`-prefix coercion, no loose parsing — stricter than node-semver on purpose); `SemVer.FromString` is the codec for embedding in other schemas. Dual statics: `compare`, `gt`, `gte`, `lt`, `lte`, `equal`, `neq` (equality ignores build metadata per spec §10), `truncate(level)` (`"prerelease"` keeps `major.minor.patch`; `"build"` keeps prerelease, drops build). Array helpers `sort`/`rsort`/`max`/`min` (the last two return `Option<SemVer>`, `None` on empty input); grouping `groupBy(versions, "major" | "minor" | "patch")` → `Record<string, ReadonlyArray<SemVer>>`, plus `latestByMajor`/`latestByMinor`. `SemVer.Order` is a core `Order<SemVer>` following spec precedence (build metadata ignored) — hand it to `Array.sort`/`Array.sortBy` instead of wrapping `compare` yourself; `SemVer.OrderWithBuild` adds a lexical build-metadata tiebreak for a total order over distinct version strings (not spec precedence). Instances carry a fluent `bump` namespace (a `SemVerBump`): `v.bump.major()`, `.minor()`, `.patch()` each reset the components below them and drop prerelease/build; `.prerelease(id?)` is node-semver compatible (a stable version starts a prerelease of the next patch, switching identifiers resets the counter, a trailing numeric identifier increments); `.release()` strips prerelease and build. Also: `.isPrerelease`/`.isStable` getters, `[Equal.symbol]`/`[Hash.symbol]`.
- **`Comparator`** — one operator (`= > >= < <=`, missing prefix means `=`) + version; no wildcards or range sugar. `Comparator.parse(input)` → `Effect<Comparator, InvalidComparatorError>`, `.FromString` codec, instance `test(version)`.
- **`Range`** — a union (OR) of comparator sets (AND within a set); parses node-semver syntax (hyphen ranges, X-ranges, `~`, `^`, `||`) and normalizes on parse. `Range.parse(input)` → `Effect<Range, InvalidRangeError>`, `.FromString` codec. Matching statics (all dual API): `satisfies`, `filter` (preserves order), `maxSatisfying`/`minSatisfying` (→ `Option<SemVer>`). Algebra: `union` (comparator-set union), `intersect` (cross-product of sets, keeping satisfiable ones — fails `UnsatisfiableConstraintError` when none remain), `isSubset`/`equivalent` (conservative — false negatives are a known, safe limitation, not a bug), `simplify` (drops comparator sets that are subsets of another set in the same range). Instance `test(version)` (enforces node-semver's prerelease restriction — a prerelease only matches when some comparator carries a prerelease on the same `major.minor.patch`) and `filter(versions)`.
- **`VersionDiff`** — `VersionDiff.between(a, b)` is the sole diff entry point (there is no `SemVer.diff`); a `Schema.TaggedClass` carrying `type` (`"major" | "minor" | "patch" | "prerelease" | "build" | "none"` — the highest-precedence field that differs), `from`, `to`, and signed numeric deltas `major`/`minor`/`patch` (`to.X - from.X`).
- **`VersionCache`** — a `Context.Service` (`VersionCache.layer`, a `Ref`-backed live implementation requiring nothing): `load(versions)`/`add(version)`/`remove(version)` (never fail); `versions()` (ascending, `[]` if empty) and `filter(range)` (never fail, `[]` when nothing matches); `latest()`/`oldest()` fail `EmptyCacheError` on an empty cache; `resolve(range)` fails `UnsatisfiedRangeError` when nothing satisfies; `resolveString(input)` additionally fails `InvalidRangeError` when the string itself doesn't parse; `diff(a, b)`/`next(v)`/`prev(v)` fail `VersionNotFoundError` when a referenced version isn't cached — `next`/`prev` further distinguish "not cached" (typed failure) from "cached but at the boundary" (`Option.none()`).

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

Range algebra — narrowing two independently-sourced constraints to their overlap:

```ts
import { Range } from "@effected/semver";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const engines = yield* Range.parse(">=18.0.0");
  const peer = yield* Range.parse("^18.2.0 || ^20.0.0");
  // Fails typed UnsatisfiableConstraintError if the two ranges share no version.
  const combined = yield* Range.intersect(engines, peer);
  return combined.toString();
});
```

Sorting with `SemVer.Order` instead of a hand-rolled comparator, and classifying the jump between two releases:

```ts
import { SemVer, VersionDiff } from "@effected/semver";
import { Array as Arr, Effect } from "effect";

const program = Effect.gen(function* () {
  const versions = yield* Effect.forEach(["2.0.0", "1.5.0", "1.9.0"], SemVer.parse);
  const sorted = Arr.sort(versions, SemVer.Order);
  const diff = VersionDiff.between(sorted[0] as SemVer, sorted[sorted.length - 1] as SemVer);
  return diff.type; // "major"
});
```

`VersionCache` — resolving a range against a live set and handling the typed misses:

```ts
import { VersionCache } from "@effected/semver";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const cache = yield* VersionCache;
  yield* cache.load(yield* Effect.forEach(["1.0.0", "1.2.0", "2.0.0"], SemVer.parse));
  return yield* cache.resolveString("^1.0.0").pipe(
    Effect.catchTag("UnsatisfiedRangeError", (e) => Effect.succeed(`none of ${e.available.length} versions match`)),
  );
}).pipe(Effect.provide(VersionCache.layer));
```

## Testing machinery

No dedicated test fixtures exported. `VersionCache.layer` is a real, dependency-free layer — provide it directly in tests that exercise cache-driven code.

## Gotchas

- Equality ignores build metadata (spec §10) but includes prerelease identifiers (spec §11); `SemVer` implements both `Equal` and `Hash`, and `VersionCache` dedupe inherits this.
- `Range.isSubset` (and `equivalent`/`simplify`) is a conservative approximation — false negatives are expected, not bugs.
- `Range.test` enforces node-semver's prerelease restriction: a prerelease only matches when some comparator carries a prerelease on the same `major.minor.patch` tuple.
- `SemVer.Order` ignores build metadata, same as `equal`/`compare` — reach for `SemVer.OrderWithBuild` if two versions differing only in build metadata must sort deterministically rather than tie.
- `Package.setVersion` (in `@effected/package-json`) takes a version **string**, not a `SemVer` — `pkg.version.bump.patch().toString()`, not the bare `SemVer` instance.
