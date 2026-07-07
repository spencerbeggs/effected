---
"@effected/semver": minor
---

## Features

Initial release of `@effected/semver` — strict SemVer 2.0.0 versions, ranges, and comparators modeled as Effect `Schema` classes. Domain classes carry their own behavior: instance methods are the canonical API, cross-cutting operations are dual statics on the owning class, and each class doubles as its schema via a `FromString` transform to and from its canonical string form.

```ts
import { Range, SemVer } from "@effected/semver";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const version = yield* SemVer.parse("1.2.3");
	const next = version.bump.minor(); // 1.3.0
	const range = yield* Range.parse("^1.0.0");
	console.log(range.test(version)); // true
	console.log(version.gt(next)); // false
});
```

### Domain Classes

* `SemVer` — a parsed version with validated `major`/`minor`/`patch`, prerelease and build identifiers; `SemVer.FromString` decodes/encodes the canonical string form. No loose parsing or `v`-prefix coercion, unlike node-semver.
* `Comparator` — a single operator + version constraint (`>=1.2.3`), with `Comparator.FromString`.
* `Range` — a set of comparator sets (`^1.0.0`, `>=1.0.0 <2.0.0 || >=3.0.0`), with `Range.FromString` and `.test()` against a `SemVer`.
* `VersionDiff` — the difference between two versions: a `type` classification (`"major"` | `"minor"` | `"patch"` | `"prerelease"` | `"build"` | `"none"`) plus signed numeric deltas, via `VersionDiff.between(a, b)`.

### VersionCache Service

`VersionCache` is an `Effect` service (`Context.Service`) providing an in-memory, sorted, deduplicated cache of `SemVer` versions with mutation (`load`, `add`, `remove`), query (`versions`, `latest`, `oldest`, `filter`), range resolution (`resolve`, `resolveString`), and navigation (`diff`, `next`, `prev`). Construct it with the co-located `VersionCache.layer`:

```ts
import { SemVer, VersionCache } from "@effected/semver";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const cache = yield* VersionCache;
	yield* cache.load([SemVer.of(1, 0, 0), SemVer.of(2, 0, 0)]);
	const latest = yield* cache.latest();
	console.log(latest.toString()); // "2.0.0"
}).pipe(Effect.provide(VersionCache.layer));
```

### Typed Errors

Seven `Schema.TaggedErrorClass` errors cover every failure mode: `InvalidVersionError`, `InvalidComparatorError`, `InvalidRangeError`, `UnsatisfiableConstraintError` (parsing/validation), and `EmptyCacheError`, `VersionNotFoundError`, `UnsatisfiedRangeError` (`VersionCache` operations). Each carries structured payload fields (e.g. the offending input, the range and available versions) rather than opaque messages.
