---
"@effected/semver": minor
---

## Features

### `parseResult` on `SemVer`, `Range` and `Comparator`, plus `Range.intersectResult`

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

Parity is asserted rather than assumed. Every case — full versions, prereleases, build metadata, caret, tilde, x-range, hyphen and union ranges, and the malformed inputs for each — is checked in both directions, along with both the data-first and data-last forms of `intersectResult`, so a future edit that re-derives the grammar on one side fails in this package's own suite rather than in a consumer.
