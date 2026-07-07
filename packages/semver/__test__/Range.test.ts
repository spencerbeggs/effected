import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { InvalidRangeError, Range, SemVer, UnsatisfiableConstraintError } from "../src/index.js";

const parse = (input: string) => Effect.runSync(Range.parse(input));
const version = (input: string) => Effect.runSync(SemVer.parse(input));

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
				assert.isTrue(range.test(version("0.0.1")));
				assert.isTrue(range.test(version("999.0.0")));
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
		it("matches instance and static forms identically", () => {
			const range = parse("^1.0.0");
			const versions = ["0.9.0", "1.0.0", "1.9.9", "2.0.0"].map(version);
			assert.deepStrictEqual(range.filter(versions).map(String), ["1.0.0", "1.9.9"]);
			assert.deepStrictEqual(Range.filter(versions, range), range.filter(versions));
			assert.isTrue(Range.satisfies(version("1.5.0"), range));
			assert.isTrue(Range.satisfies(range)(version("1.5.0")));
		});

		it("enforces the prerelease tuple restriction", () => {
			const range = parse(">=1.0.0 <2.0.0");
			assert.isFalse(range.test(version("1.5.0-alpha")));
			const withTuple = parse(">=1.5.0-0 <2.0.0");
			assert.isTrue(withTuple.test(version("1.5.0-alpha")));
		});
	});

	describe("maxSatisfying / minSatisfying", () => {
		const versions = ["0.9.0", "1.0.0", "1.5.0", "1.9.9", "2.0.0"].map(version);

		it("finds the extremum satisfying version as an Option", () => {
			const range = parse("^1.0.0");
			assert.deepStrictEqual(Range.maxSatisfying(versions, range).pipe(Option.map(String)), Option.some("1.9.9"));
			assert.deepStrictEqual(Range.minSatisfying(versions, range).pipe(Option.map(String)), Option.some("1.0.0"));
			assert.isTrue(Option.isNone(Range.maxSatisfying(versions, parse(">=3.0.0"))));
		});
	});

	describe("algebra", () => {
		it("union combines with OR semantics", () => {
			const combined = Range.union(parse("^1.0.0"), parse("^2.0.0"));
			assert.isTrue(combined.test(version("1.5.0")));
			assert.isTrue(combined.test(version("2.5.0")));
			assert.isFalse(combined.test(version("3.0.0")));
		});

		it.effect("intersect keeps only versions matching both", () =>
			Effect.gen(function* () {
				const both = yield* Range.intersect(yield* Range.parse(">=1.0.0"), yield* Range.parse("<2.0.0"));
				assert.isTrue(both.test(version("1.5.0")));
				assert.isFalse(both.test(version("2.0.0")));
				assert.isFalse(both.test(version("0.9.0")));
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

		it("isSubset detects containment and documents its conservative approximation", () => {
			assert.isTrue(Range.isSubset(parse("^1.2.0"), parse(">=1.0.0")));
			assert.isFalse(Range.isSubset(parse(">=1.0.0"), parse("^1.2.0")));
			// Documented false negative: the sub-range straddles sup's set boundary.
			assert.isFalse(Range.isSubset(parse(">=1.0.0 <3.0.0"), parse(">=1.0.0 <2.0.0 || >=2.0.0 <3.0.0")));
		});

		it("equivalent is mutual subset", () => {
			assert.isTrue(Range.equivalent(parse("^1.2.3"), parse(">=1.2.3 <2.0.0-0")));
			assert.isFalse(Range.equivalent(parse("^1.2.3"), parse("~1.2.3")));
		});

		it("simplify drops redundant comparator sets", () => {
			const range = parse("^1.2.0 || >=1.0.0");
			const simplified = Range.simplify(range);
			assert.strictEqual(simplified.sets.length, 1);
			assert.strictEqual(simplified.toString(), ">=1.0.0");
		});
	});
});
