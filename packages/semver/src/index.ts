/**
 * Strict SemVer 2.0.0 versions, ranges and comparators as Effect schemas.
 *
 * Domain classes carry their own behavior — instance methods are the
 * canonical API, cross-cutting operations are dual statics on the owning
 * class, and each class doubles as its schema (`SemVer.FromString`,
 * `Range.FromString`, `Comparator.FromString` transform to and from the
 * canonical strings).
 *
 * @example
 * ```ts
 * import { Range, SemVer } from "@effected/semver";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const version = yield* SemVer.parse("1.2.3");
 *   const next = version.bump.minor();       // 1.3.0
 *   const range = yield* Range.parse("^1.0.0");
 *   console.log(range.test(version));        // true
 *   console.log(version.gt(next));           // false
 * });
 * ```
 *
 * @see {@link https://semver.org | SemVer 2.0.0 Specification}
 * @see {@link https://effect.website | Effect}
 *
 * @packageDocumentation
 */

export { Comparator, Comparator_base, InvalidComparatorError, InvalidComparatorError_base } from "./Comparator.js";
export {
	type ComparatorSet,
	InvalidRangeError,
	InvalidRangeError_base,
	Range,
	Range_base,
	UnsatisfiableConstraintError,
	UnsatisfiableConstraintError_base,
} from "./Range.js";
export {
	InvalidVersionError,
	InvalidVersionError_base,
	SemVer,
	SemVerBump,
	SemVer_base,
	buildIdentifier,
	nonNegativeInteger,
	prereleaseIdentifier,
} from "./SemVer.js";
export {
	EmptyCacheError,
	EmptyCacheError_base,
	UnsatisfiedRangeError,
	UnsatisfiedRangeError_base,
	VersionCache,
	type VersionCacheShape,
	VersionCache_base,
	VersionNotFoundError,
	VersionNotFoundError_base,
} from "./VersionCache.js";
export { VersionDiff, VersionDiff_base } from "./VersionDiff.js";
