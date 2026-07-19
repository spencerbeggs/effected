# @effected/semver

## 0.1.1

### Dependencies

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.0

### Features

* Strict SemVer 2.0.0 versions, ranges and comparators as Effect schemas. `SemVer`, `Comparator` and `Range` are `Schema.Class`es — a version is a validated value with methods on it, not a string you re-parse at every call site — and each carries a `FromString` codec you can embed in your own schemas. Parsing is strict (no `v` prefix, no leading zeros, no partial consumption) and every failure is a tagged error carrying the offending string and the position where the grammar gave up. Zero runtime dependencies, no IO.

  ### Versions

  Parse, bump, compare and truncate. Instance methods are canonical; cross-cutting operations are dual statics on the owning class.

  ```ts
  import { Range, SemVer } from "@effected/semver";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const version = yield* SemVer.parse("1.2.3");
    const next = version.bump.minor();
    const range = yield* Range.parse("^1.0.0");
    return [next.toString(), range.test(version), version.gt(next)] as const;
  });

  console.log(Effect.runSync(program));
  // => ["1.3.0", true, false]
  ```

  Equality follows the spec, not the string: `Equal.equals` ignores build metadata and includes prerelease identifiers, and `SemVer` overrides `[Hash.symbol]` to agree. Collection operations are statics — `sort`, `max`, `min`, `groupBy`, `latestByMajor`, `latestByMinor`.

  ### Ranges and comparators

  A `Range` is a union of comparator sets parsed from the node-semver dialect (hyphen ranges, X-ranges, tilde, caret, `||`). The algebra is `union`, `intersect`, `isSubset`, `equivalent` and `simplify`; intersecting disjoint ranges fails with `UnsatisfiableConstraintError` rather than quietly returning a range that matches nothing.

  ```ts
  import { Range, SemVer } from "@effected/semver";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const caret = yield* Range.parse("^1.0.0");
    const floor = yield* Range.parse(">=1.5.0");
    const both = yield* Range.intersect(caret, floor);
    const versions = [SemVer.of(1, 2, 0), SemVer.of(1, 6, 0), SemVer.of(2, 0, 0)];
    return [both.test(SemVer.of(1, 6, 0)), Range.filter(versions, caret).map((v) => v.toString())] as const;
  });

  console.log(Effect.runSync(program));
  // => [true, ["1.2.0", "1.6.0"]]
  ```

  ### Diffing and the version cache

  `VersionDiff.between(a, b)` classifies a change and carries the signed component deltas. `VersionCache` is a `Context.Service` over a sorted, deduplicated version set with range resolution and neighbor navigation, provided by `VersionCache.layer`.

  ```ts
  import { SemVer, VersionCache } from "@effected/semver";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const cache = yield* VersionCache;
    yield* cache.load([SemVer.of(1, 0, 0), SemVer.of(1, 4, 2), SemVer.of(2, 0, 0)]);
    const latest = yield* cache.latest();
    const resolved = yield* cache.resolveString("^1.0.0");
    return [latest.toString(), resolved.toString()] as const;
  }).pipe(Effect.provide(VersionCache.layer));

  console.log(Effect.runSync(program));
  // => ["2.0.0", "1.4.2"]
  ```

  Seven tagged errors — `InvalidVersionError`, `InvalidComparatorError`, `InvalidRangeError`, `UnsatisfiableConstraintError`, `EmptyCacheError`, `VersionNotFoundError`, `UnsatisfiedRangeError` — each carry the structured payload a caller needs to report what actually went wrong. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
