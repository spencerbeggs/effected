import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { InvalidRangeError, Range, SemVer, UnsatisfiableConstraintError } from "../src/index.js";

describe("Range", () => {
	describe("parse", () => {
		it.effect("desugars caret ranges into primitive comparators", () =>
			Effect.gen(function* () {
				const range = yield* Range.parse("^1.2.3");
				assert.strictEqual(range.toString(), ">=1.2.3 <2.0.0-0");
			}),
		);

		it.effect("parses OR unions of comparator sets", () =>
			Effect.gen(function* () {
				const range = yield* Range.parse("^1.2.0 || 2.x");
				assert.strictEqual(range.sets.length, 2);
			}),
		);

		it.effect("parses the empty string as match-all", () =>
			Effect.gen(function* () {
				const range = yield* Range.parse("");
				assert.isTrue(range.test(yield* SemVer.parse("0.0.1")));
				assert.isTrue(range.test(yield* SemVer.parse("999.0.0")));
			}),
		);

		it.effect("normalizes duplicate comparators differing only in build metadata", () =>
			Effect.gen(function* () {
				const range = yield* Range.parse(">=1.0.0+a >=1.0.0+b");
				assert.strictEqual(range.sets[0].length, 1);
			}),
		);

		it.effect("fails with InvalidRangeError carrying input and position", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Range.parse("~>1.0.0"));
				assert.instanceOf(error, InvalidRangeError);
				assert.strictEqual(error._tag, "InvalidRangeError");
				assert.strictEqual(error.input, "~>1.0.0");
				assert.isNumber(error.position);
			}),
		);
	});

	describe("FromString", () => {
		it.effect("decodes and encodes canonically", () =>
			Effect.gen(function* () {
				const range = yield* Schema.decodeUnknownEffect(Range.FromString)("^1.0.0 || 2.x");
				assert.instanceOf(range, Range);
				const encoded = yield* Schema.encodeUnknownEffect(Range.FromString)(range);
				const reparsed = yield* Schema.decodeUnknownEffect(Range.FromString)(encoded);
				assert.strictEqual(reparsed.toString(), range.toString());
			}),
		);
	});

	describe("test and filter", () => {
		it.effect("matches instance and static forms identically", () =>
			Effect.gen(function* () {
				const range = yield* Range.parse("^1.0.0");
				const versions = yield* Effect.all(["0.9.0", "1.0.0", "1.9.9", "2.0.0"].map((s) => SemVer.parse(s)));
				assert.deepStrictEqual(range.filter(versions).map(String), ["1.0.0", "1.9.9"]);
				assert.deepStrictEqual(Range.filter(versions, range), range.filter(versions));
				assert.isTrue(Range.satisfies(yield* SemVer.parse("1.5.0"), range));
				assert.isTrue(Range.satisfies(range)(yield* SemVer.parse("1.5.0")));
			}),
		);

		it.effect("enforces the prerelease tuple restriction", () =>
			Effect.gen(function* () {
				const range = yield* Range.parse(">=1.0.0 <2.0.0");
				assert.isFalse(range.test(yield* SemVer.parse("1.5.0-alpha")));
				const withTuple = yield* Range.parse(">=1.5.0-0 <2.0.0");
				assert.isTrue(withTuple.test(yield* SemVer.parse("1.5.0-alpha")));
			}),
		);
	});

	describe("maxSatisfying / minSatisfying", () => {
		it.effect("finds the extremum satisfying version as an Option", () =>
			Effect.gen(function* () {
				const versions = yield* Effect.all(["0.9.0", "1.0.0", "1.5.0", "1.9.9", "2.0.0"].map((s) => SemVer.parse(s)));
				const range = yield* Range.parse("^1.0.0");
				assert.deepStrictEqual(Range.maxSatisfying(versions, range).pipe(Option.map(String)), Option.some("1.9.9"));
				assert.deepStrictEqual(Range.minSatisfying(versions, range).pipe(Option.map(String)), Option.some("1.0.0"));
				assert.isTrue(Option.isNone(Range.maxSatisfying(versions, yield* Range.parse(">=3.0.0"))));
			}),
		);
	});

	describe("algebra", () => {
		it.effect("union combines with OR semantics", () =>
			Effect.gen(function* () {
				const combined = Range.union(yield* Range.parse("^1.0.0"), yield* Range.parse("^2.0.0"));
				assert.isTrue(combined.test(yield* SemVer.parse("1.5.0")));
				assert.isTrue(combined.test(yield* SemVer.parse("2.5.0")));
				assert.isFalse(combined.test(yield* SemVer.parse("3.0.0")));
			}),
		);

		it.effect("intersect keeps only versions matching both", () =>
			Effect.gen(function* () {
				const both = yield* Range.intersect(yield* Range.parse(">=1.0.0"), yield* Range.parse("<2.0.0"));
				assert.isTrue(both.test(yield* SemVer.parse("1.5.0")));
				assert.isFalse(both.test(yield* SemVer.parse("2.0.0")));
				assert.isFalse(both.test(yield* SemVer.parse("0.9.0")));
			}),
		);

		it.effect("intersect supports the data-last call form", () =>
			Effect.gen(function* () {
				const lower = yield* Range.parse(">=1.0.0");
				const upper = yield* Range.parse("<2.0.0");
				// Data-last: intersect(that)(self) intersects self with that.
				const both = yield* Range.intersect(upper)(lower);
				assert.isTrue(both.test(yield* SemVer.parse("1.5.0")));
				assert.isFalse(both.test(yield* SemVer.parse("2.0.0")));
			}),
		);

		it.effect("intersect fails typed on unsatisfiable constraints", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Range.intersect(yield* Range.parse("<1.0.0"), yield* Range.parse(">=2.0.0")));
				assert.instanceOf(error, UnsatisfiableConstraintError);
				assert.strictEqual(error._tag, "UnsatisfiableConstraintError");
				assert.strictEqual(error.constraints.length, 2);
				assert.strictEqual(error.message, "No version satisfies all 2 constraints");
			}),
		);

		it.effect("isSubset detects containment and documents its conservative approximation", () =>
			Effect.gen(function* () {
				assert.isTrue(Range.isSubset(yield* Range.parse("^1.2.0"), yield* Range.parse(">=1.0.0")));
				assert.isFalse(Range.isSubset(yield* Range.parse(">=1.0.0"), yield* Range.parse("^1.2.0")));
				// Documented false negative: the sub-range straddles sup's set boundary.
				assert.isFalse(
					Range.isSubset(yield* Range.parse(">=1.0.0 <3.0.0"), yield* Range.parse(">=1.0.0 <2.0.0 || >=2.0.0 <3.0.0")),
				);
			}),
		);

		it.effect("equivalent is mutual subset", () =>
			Effect.gen(function* () {
				assert.isTrue(Range.equivalent(yield* Range.parse("^1.2.3"), yield* Range.parse(">=1.2.3 <2.0.0-0")));
				assert.isFalse(Range.equivalent(yield* Range.parse("^1.2.3"), yield* Range.parse("~1.2.3")));
			}),
		);

		it.effect("simplify drops redundant comparator sets", () =>
			Effect.gen(function* () {
				const range = yield* Range.parse("^1.2.0 || >=1.0.0");
				const simplified = Range.simplify(range);
				assert.strictEqual(simplified.sets.length, 1);
				assert.strictEqual(simplified.toString(), ">=1.0.0");
			}),
		);
	});
});
