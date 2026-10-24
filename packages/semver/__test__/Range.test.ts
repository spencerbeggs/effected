import { assert, describe, it } from "@effect/vitest";
import { Effect, Equal, Option, Result, Schema } from "effect";
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

	describe("includePrerelease", () => {
		it.effect("is a parse option the range records and every matcher honours", () =>
			Effect.gen(function* () {
				const loose = yield* Range.parse("^1.2", { includePrerelease: true });
				const strict = yield* Range.parse("^1.2");
				assert.isTrue(loose.includePrerelease);
				assert.isFalse(strict.includePrerelease);
				const candidate = yield* SemVer.parse("1.2.5-beta.1");
				assert.isTrue(loose.test(candidate));
				assert.isFalse(strict.test(candidate));
				assert.isTrue(Range.satisfies(candidate, loose));
				assert.isTrue(Range.satisfies(loose)(candidate));
				const versions = yield* Effect.all(["1.2.0", "1.2.5-beta.1", "1.3.0-0", "2.0.0-0"].map((v) => SemVer.parse(v)));
				assert.deepStrictEqual(loose.filter(versions).map(String), ["1.2.0", "1.2.5-beta.1", "1.3.0-0"]);
				assert.deepStrictEqual(strict.filter(versions).map(String), ["1.2.0"]);
				assert.deepStrictEqual(Range.maxSatisfying(versions, loose).pipe(Option.map(String)), Option.some("1.3.0-0"));
				assert.deepStrictEqual(Range.maxSatisfying(versions, strict).pipe(Option.map(String)), Option.some("1.2.0"));
				assert.deepStrictEqual(Range.minSatisfying(versions, loose).pipe(Option.map(String)), Option.some("1.2.0"));
			}),
		);

		it.effect("lowers wildcard floors to -0 but leaves a full floor alone", () =>
			Effect.gen(function* () {
				assert.strictEqual((yield* Range.parse("^1.2", { includePrerelease: true })).toString(), ">=1.2.0-0 <2.0.0-0");
				assert.strictEqual((yield* Range.parse("^1.2.3", { includePrerelease: true })).toString(), ">=1.2.3 <2.0.0-0");
				assert.strictEqual((yield* Range.parse(">1.2", { includePrerelease: true })).toString(), ">=1.3.0-0");
				assert.strictEqual((yield* Range.parse(">=1.2.0", { includePrerelease: true })).toString(), ">=1.2.0");
				assert.strictEqual((yield* Range.parse("*", { includePrerelease: true })).toString(), ">=0.0.0-0");
				assert.strictEqual(
					(yield* Range.parse("1.2.3 - 2", { includePrerelease: true })).toString(),
					">=1.2.3-0 <3.0.0-0",
				);
				assert.strictEqual(
					(yield* Range.parse("1.2.3-beta - 2", { includePrerelease: true })).toString(),
					">=1.2.3-beta <3.0.0-0",
				);
			}),
		);

		it.effect("an explicit false and an omitted option are the default rule", () =>
			Effect.gen(function* () {
				const explicit = yield* Range.parse("^1.2", { includePrerelease: false });
				const omitted = yield* Range.parse("^1.2");
				const undefinedOption = yield* Range.parse("^1.2", { includePrerelease: undefined });
				assert.isTrue(Equal.equals(explicit, omitted));
				assert.isTrue(Equal.equals(undefinedOption, omitted));
				assert.strictEqual(
					Range.parseResult("^1.2", {}).pipe(
						Result.map((r) => r.includePrerelease),
						Result.getOrThrow,
					),
					false,
				);
			}),
		);

		it.effect("two ranges that differ only in the flag are not Equal", () =>
			Effect.gen(function* () {
				const loose = yield* Range.parse(">=1.2.0-0 <2.0.0-0", { includePrerelease: true });
				const strict = yield* Range.parse(">=1.2.0-0 <2.0.0-0");
				assert.strictEqual(loose.toString(), strict.toString());
				assert.isFalse(Equal.equals(loose, strict));
				assert.isTrue(Equal.equals(Range.make({ sets: strict.sets }), strict));
			}),
		);

		it.effect("the struct form keeps the flag, the string form cannot", () =>
			Effect.gen(function* () {
				const loose = yield* Range.parse("^1.2", { includePrerelease: true });
				const viaStruct = yield* Schema.decodeUnknownEffect(Range)(yield* Schema.encodeEffect(Range)(loose));
				assert.isTrue(viaStruct.includePrerelease);
				assert.isTrue(Equal.equals(viaStruct, loose));
				const legacy = yield* Schema.decodeUnknownEffect(Range)({ sets: [] });
				assert.isFalse(legacy.includePrerelease);
				const viaString = yield* Schema.decodeUnknownEffect(Range.FromString)(
					yield* Schema.encodeEffect(Range.FromString)(loose),
				);
				assert.isFalse(viaString.includePrerelease);
				assert.strictEqual(viaString.toString(), loose.toString());
			}),
		);

		it.effect("union, intersect and simplify carry self's flag", () =>
			Effect.gen(function* () {
				const loose = yield* Range.parse("^1.0.0", { includePrerelease: true });
				const strict = yield* Range.parse("^2.0.0");
				assert.isTrue(Range.union(loose, strict).includePrerelease);
				assert.isFalse(Range.union(strict, loose).includePrerelease);
				assert.isTrue((yield* Range.intersect(loose, yield* Range.parse("<1.5.0"))).includePrerelease);
				assert.isFalse(
					(yield* Range.intersect(strict, yield* Range.parse(">=2.1.0", { includePrerelease: true })))
						.includePrerelease,
				);
				assert.isTrue(
					Range.simplify(Range.union(loose, yield* Range.parse("^1.2.0", { includePrerelease: true })))
						.includePrerelease,
				);
			}),
		);

		it.effect("a prerelease-including range is never a subset of a default one", () =>
			Effect.gen(function* () {
				const loose = yield* Range.parse("^1.2.3", { includePrerelease: true });
				const strict = yield* Range.parse("^1.2.3");
				assert.isFalse(Range.isSubset(loose, strict));
				assert.isTrue(Range.isSubset(strict, loose));
				assert.isFalse(Range.equivalent(loose, strict));
				assert.isTrue(Range.equivalent(loose, yield* Range.parse(">=1.2.3 <2.0.0-0", { includePrerelease: true })));
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

	// `parseResult` and `intersectResult` are the primitives; `parse` and
	// `intersect` derive from them via `Effect.fromResult` and add only the
	// tracing span. Both directions are asserted per row so the two forms
	// cannot drift.
	describe("Result parity", () => {
		const parseRows: ReadonlyArray<readonly [label: string, input: string]> = [
			["a caret range", "^1.0.0"],
			["a tilde range", "~1.2.3"],
			["an x-range", "1.x"],
			["a wildcard", "*"],
			["a hyphen range", "1.0.0 - 2.0.0"],
			["a union", "^1.2.0 || >=3.0.0"],
			["a prerelease bound", ">=1.0.0-rc.1 <2.0.0"],
			["a bad operator", "~>1.2.3"],
			["an unparseable operand", "^not-a-version"],
			["the empty string", ""],
		];

		for (const [label, input] of parseRows) {
			it.effect(`parse and parseResult agree on ${label}`, () =>
				Effect.gen(function* () {
					const viaEffect = yield* Effect.result(Range.parse(input));
					assert.deepStrictEqual(Range.parseResult(input), viaEffect);
				}),
			);
		}

		it("parseResult succeeds with a normalized Range", () => {
			const result = Range.parseResult("^1.0.0");
			if (Result.isFailure(result)) {
				return assert.fail("expected a successful parse");
			}
			assert.instanceOf(result.success, Range);
			assert.strictEqual(result.success.toString(), ">=1.0.0 <2.0.0-0");
		});

		it("parseResult carries the typed failure, not a throw", () => {
			const result = Range.parseResult("~>1.2.3");
			if (Result.isSuccess(result)) {
				return assert.fail("expected a typed parse failure");
			}
			assert.instanceOf(result.failure, InvalidRangeError);
			assert.strictEqual(result.failure.input, "~>1.2.3");
		});

		const intersectRows: ReadonlyArray<readonly [label: string, a: string, b: string]> = [
			["overlapping ranges", "^1.0.0", ">=1.5.0"],
			["identical ranges", "^1.0.0", "^1.0.0"],
			["a wildcard against a caret", "*", "^2.0.0"],
			["unions on both sides", "^1.0.0 || ^3.0.0", "^1.2.0 || ^3.1.0"],
			["disjoint ranges", "^1.0.0", "^2.0.0"],
			["a fully empty intersection", "<1.0.0", ">=2.0.0"],
		];

		for (const [label, a, b] of intersectRows) {
			it.effect(`intersect and intersectResult agree on ${label}`, () =>
				Effect.gen(function* () {
					const left = yield* Range.parse(a);
					const right = yield* Range.parse(b);
					const viaEffect = yield* Effect.result(Range.intersect(left, right));
					assert.deepStrictEqual(Range.intersectResult(left, right), viaEffect);
				}),
			);
		}

		// `Range` is a `Schema.Class`, which is not `Pipeable` in v4, so the
		// data-last forms are applied directly rather than through `.pipe`.
		it.effect("the data-last forms of both agree too", () =>
			Effect.gen(function* () {
				const left = yield* Range.parse("^1.0.0");
				const right = yield* Range.parse(">=1.5.0");
				const viaEffect = yield* Effect.result(Range.intersect(right)(left));
				const viaResult = Range.intersectResult(right)(left);
				assert.deepStrictEqual(viaResult, viaEffect);
				assert.deepStrictEqual(viaResult, Range.intersectResult(left, right));
			}),
		);

		it.effect("intersectResult carries the typed failure, not a throw", () =>
			Effect.gen(function* () {
				const left = yield* Range.parse("^1.0.0");
				const right = yield* Range.parse("^2.0.0");
				const result = Range.intersectResult(left, right);
				if (Result.isSuccess(result)) {
					return assert.fail("expected a typed intersection failure");
				}
				assert.instanceOf(result.failure, UnsatisfiableConstraintError);
				assert.deepStrictEqual([...result.failure.constraints], [left, right]);
			}),
		);
	});
});
