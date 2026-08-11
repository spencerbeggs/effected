# @effected/semver

## 0.4.0

### Bug Fixes

* Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
* Updated `SemVer`, `Range`, and `Comparator`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.3.2

### Documentation

* The dual matching statics on `Range` — `satisfies`, `filter`, `maxSatisfying`, `minSatisfying` — now state their data-first argument order explicitly: the subject comes first, the range second. "Dual API" alone did not say which order the data-first form takes, and the order is not recoverable from the call site when the two parameters are distinct classes.
* `Range.satisfies` additionally documents the failure a flipped call produces. TypeScript rejects it outright, so it only reaches callers without type checking — including untyped runtime probes — where it dispatches data-first and dies with `TypeError: range.test is not a function`, a message naming the parameter that received the version and so reading as a defect inside the package rather than a caller error. [#268][#268]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#268]: https://github.com/spencerbeggs/effected/pull/268

## 0.3.1

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.3.0

### Features

* ### Exact-version string schemas

  Two new `Schema.String`-typed refinements for consumer structs whose field must stay a plain string while still refusing anything that is not exactly one version:

  * `SemVer.ExactVersionString` — a valid SemVer 2.0.0 version, exactly as given (build metadata allowed).
  * `SemVer.PinnableVersionString` — the same, but rejects build metadata too: the notion a `<name>@<version>[+<integrity>]` pin grammar needs, since the first `+` after the version always begins the integrity component.

  Both stay typed as `string`; decode through `SemVer.FromString` instead when the parsed components are wanted.

  ### Validity predicates

  * `SemVer.isValid(input)` — `true` when `input` is a valid version string with **no** surrounding whitespace. `SemVer.parse`/`parseResult` continue to trim, matching node-semver's constructor; this predicate answers the stricter question "is this string, byte for byte, a version?"
  * `SemVer.isPinnable(input)` — `true` when `input` is valid by `isValid` **and** carries no build metadata.

  ````ts
  import { SemVer } from "@effected/semver";

  SemVer.isValid(" 1.2.3"); // false — parse() would trim and accept it
  SemVer.isPinnable("1.2.3+build"); // false — build metadata present
  ``` [#215](https://github.com/spencerbeggs/effected/pull/215) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````

## 0.2.1

### Dependencies

* | Dependency | Type           | Action  | From          | To             |                                                                       |
  | ---------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.2.0

### Features

* ### `parseResult` on `SemVer`, `Range` and `Comparator`, plus `Range.intersectResult`

  The three `parse` statics ran a synchronous recursive-descent grammar behind an `Effect`, so the wrapper carried nothing but a tracing span and the error channel. A synchronous caller — a lint-staged handler, a non-Effect version checker — had to build a runtime to parse a version string. Each now has a sync twin returning `Result` directly:

  ```ts
  import { Range, SemVer } from "@effected/semver";
  import { Result } from "effect";

  const version = SemVer.parseResult("1.2.3"); // Result<SemVer, InvalidVersionError>
  const range = Range.parseResult("^1.0.0"); // Result<Range, InvalidRangeError>

  if (Result.isSuccess(version) && Result.isSuccess(range)) {
  	console.log(Range.satisfies(version.success, range.success)); // => true
  }
  ```

  `Comparator.parseResult` completes the set, returning `Result<Comparator, InvalidComparatorError>`.

  `Range.intersect` gets the same treatment as `Range.intersectResult`, a dual static returning `Result<Range, UnsatisfiableConstraintError>`. It is the only other surface in the package with this shape — a pure, total cross-product over comparator sets whose one failure mode, an empty intersection, is already a typed error. A version-solving loop calling it thousands of times per resolution is exactly the caller that should not be paying for a span, and leaving it as the one pure fallible boundary still reachable only through `Effect` would have made the package's own surface inconsistent on the axis this change exists to settle.

  This follows the kit's sync-primitive convention, matching `Jsonc.parseResult` and `Markdown.parseResult`. Every existing signature is unchanged. `SemVer.parse`, `Range.parse`, `Comparator.parse` and `Range.intersect` keep their exact types, error channels and named spans, and are now defined in terms of their `Result` twins via `Effect.fromResult`, so the two forms cannot drift — the `Result` variant is the single engine path and the `Effect` variant adds only the span.

  Nothing was added to the comparison statics. `SemVer.compare` and `Range.satisfies` already return `-1 | 0 | 1` and `boolean` as plain dual functions, so they are total, synchronous and correct as they stand; a `Result` twin there would be dead surface wrapping a value that cannot fail.

  Parity is asserted rather than assumed. Every case — full versions, prereleases, build metadata, caret, tilde, x-range, hyphen and union ranges, and the malformed inputs for each — is checked in both directions, along with both the data-first and data-last forms of `intersectResult`, so a future edit that re-derives the grammar on one side fails in this package's own suite rather than in a consumer. [#125][#125]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

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
