// The range grammar's edge semantics, aligned with node-semver and core
// `SemVerRange` (#1040): wildcard-major sugar, the match-nothing `>*`/`<*`,
// hyphen ranges with a `*` side, whitespace classes, operator whitespace,
// concrete-after-wildcard rejection, and build metadata stripped in both the
// range and the comparator entry points. Each row names the exact text, so a
// regression in one desugar branch turns exactly that row red.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Equal, Result } from "effect";
import { Comparator, InvalidRangeError, Range, SemVer, UnsatisfiableConstraintError } from "../src/index.js";

const range = (input: string): Range => Result.getOrThrow(Range.parseResult(input));
const version = (input: string): SemVer => Result.getOrThrow(SemVer.parseResult(input));

describe("Range edge semantics", () => {
	describe("wildcard-major sugar matches every release", () => {
		// `^*` once desugared to `^0` (`>=0.0.0 <1.0.0-0`) and rejected 1.0.0.
		for (const input of ["^*", "~*", "^x", "~x.x", "^X", "~*.*.*", ">=*", "<=*", "=*"]) {
			it(`${input} matches 0.0.0, 1.0.0 and 7.2.4 but not 0.0.0-0`, () => {
				const r = range(input);
				assert.isTrue(r.test(version("0.0.0")));
				assert.isTrue(r.test(version("1.0.0")));
				assert.isTrue(r.test(version("7.2.4")));
				assert.isFalse(r.test(version("0.0.0-0")));
				assert.strictEqual(r.toString(), ">=0.0.0");
			});
		}
	});

	describe("> and < against a wildcard match nothing", () => {
		for (const input of [">*", "<*", ">x", "<x.x"]) {
			it(`${input} matches no version`, () => {
				const r = range(input);
				for (const v of ["0.0.0-0", "0.0.0", "1.0.0", "999.999.999"]) {
					assert.isFalse(r.test(version(v)), `${input} must not match ${v}`);
				}
				assert.strictEqual(r.toString(), "<0.0.0-0");
			});
		}

		it("a match-nothing set leaves the rest of a union intact", () => {
			const r = range(">* || ^1.0.0");
			assert.isTrue(r.test(version("1.5.0")));
			assert.isFalse(r.test(version("2.0.0")));
		});
	});

	describe("hyphen ranges with a wildcard side", () => {
		it("* - 0.0.0-1 admits 0.0.0-0 (no >=0.0.0 lower bound)", () => {
			const r = range("* - 0.0.0-1");
			assert.isTrue(r.test(version("0.0.0-0")));
			assert.strictEqual(r.toString(), "<=0.0.0-1");
		});

		it("* - 2 carries only the upper comparator", () => {
			assert.strictEqual(range("* - 2").toString(), "<3.0.0-0");
		});

		it("1.2.3 - * carries only the lower comparator", () => {
			assert.strictEqual(range("1.2.3 - *").toString(), ">=1.2.3");
		});

		it("* - * matches every release", () => {
			const r = range("* - *");
			assert.strictEqual(r.toString(), ">=0.0.0");
			assert.isTrue(r.test(version("42.0.0")));
		});
	});

	describe("whitespace", () => {
		const spelled: ReadonlyArray<readonly [input: string, canonical: string]> = [
			[">= 1.0.0", ">=1.0.0"],
			["> 1.0.0 < 2.0.0", ">1.0.0 <2.0.0"],
			["^ 1.2.3", "^1.2.3"],
			["~ 1.2.3", "~1.2.3"],
			["= 1.2.3", "1.2.3"],
			[">= 18", ">=18"],
			[">=1.0.0\t<2.0.0", ">=1.0.0 <2.0.0"],
			[">=1.0.0\n<2.0.0", ">=1.0.0 <2.0.0"],
			[">=1.0.0  <2.0.0", ">=1.0.0 <2.0.0"],
			["^1.0.0\t||\t^2.0.0", "^1.0.0 || ^2.0.0"],
			["1.0.0\t-\t2.0.0", "1.0.0 - 2.0.0"],
			["1.0.0  -  2.0.0", "1.0.0 - 2.0.0"],
		];

		for (const [input, canonical] of spelled) {
			it(`${JSON.stringify(input)} parses like ${JSON.stringify(canonical)}`, () => {
				assert.isTrue(Equal.equals(range(input), range(canonical)));
			});
		}

		for (const input of [">=1.2.3<2.0.0", "1.2.3 -2.0.0", "1.2.3- 2.0.0", ">=", "> =1.0.0"]) {
			it(`${JSON.stringify(input)} still fails`, () => {
				assert.isTrue(Result.isFailure(Range.parseResult(input)));
			});
		}
	});

	describe("a concrete component cannot follow a wildcard", () => {
		const rows: ReadonlyArray<readonly [input: string, position: number]> = [
			["1.*.3", 4],
			["x.1.2", 2],
			["*.1", 2],
			["1.x.3-beta", 4],
			[">=1.x.3", 6],
		];

		for (const [input, position] of rows) {
			it.effect(`${input} fails with InvalidRangeError at position ${position}`, () =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(Range.parse(input));
					assert.instanceOf(error, InvalidRangeError);
					assert.strictEqual(error.position, position);
				}),
			);
		}

		for (const input of ["1.x.x", "*.*.*", "x.X.*", "1.2.x"]) {
			it(`${input} (wildcards all the way down) still parses`, () => {
				assert.isTrue(Result.isSuccess(Range.parseResult(input)));
			});
		}
	});

	describe("build metadata is stripped", () => {
		it("1.2.3+build parses to the same range as 1.2.3 and prints without +build", () => {
			const r = range("1.2.3+build");
			assert.strictEqual(r.toString(), "1.2.3");
			assert.deepStrictEqual([...r.sets[0][0].version.build], []);
		});

		it("Comparator.parse and Range.parse agree on =1.2.3+b", () => {
			const comparator = Result.getOrThrow(Comparator.parseResult("=1.2.3+b"));
			const fromRange = range("=1.2.3+b").sets[0][0];
			assert.isTrue(Equal.equals(comparator, fromRange));
			assert.strictEqual(comparator.toString(), fromRange.toString());
			assert.deepStrictEqual([...comparator.version.build], []);
		});

		it("a comparator built with make prints without its build metadata", () => {
			const comparator = Comparator.make({ operator: ">=", version: SemVer.of(1, 2, 3, [], ["b"]) });
			assert.strictEqual(comparator.toString(), ">=1.2.3");
			assert.strictEqual(Range.make({ sets: [[comparator]] }).toString(), ">=1.2.3");
		});

		it("a malformed build identifier still fails", () => {
			assert.isTrue(Result.isFailure(Range.parseResult("1.2.3+")));
			assert.isTrue(Result.isFailure(Comparator.parseResult("1.2.3+a..b")));
		});
	});

	describe("range algebra over the match-nothing set", () => {
		it.effect("intersect(>*, ^1) fails with UnsatisfiableConstraintError", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Range.intersect(range(">*"), range("^1")));
				assert.instanceOf(error, UnsatisfiableConstraintError);
			}),
		);

		it("intersect(>*, <*) is unsatisfiable too, with no lower bound in sight", () => {
			assert.isTrue(Result.isFailure(Range.intersectResult(range(">*"), range("<*"))));
		});

		it("isSubset(>*, x) holds for every x, and the converse does not", () => {
			for (const sup of ["^1", "<0.0.1", "1.2.3", ">*"]) {
				assert.isTrue(Range.isSubset(range(">*"), range(sup)), `>* must be a subset of ${sup}`);
			}
			assert.isFalse(Range.isSubset(range("^1"), range(">*")));
		});

		it("simplify(>* || ^1) drops the empty set", () => {
			const simplified = Range.simplify(range(">* || ^1"));
			assert.strictEqual(simplified.toString(), ">=1.0.0 <2.0.0-0");
		});

		it("simplify(>* || <*) keeps exactly one match-nothing set", () => {
			assert.strictEqual(Range.simplify(range(">* || <*")).toString(), "<0.0.0-0");
		});
	});

	describe("simplify keeps the first of mutually-subset sets", () => {
		// Both copies of a duplicated set are subsets of each other; dropping
		// every member of the pair lost ^1 entirely.
		it("^1 || ^1 || ^2 keeps ^1 and still matches 1.5.0", () => {
			const simplified = Range.simplify(range("^1 || ^1 || ^2"));
			assert.strictEqual(simplified.toString(), ">=1.0.0 <2.0.0-0 || >=2.0.0 <3.0.0-0");
			assert.isTrue(simplified.test(version("1.5.0")));
		});

		it("two spellings of one set collapse to the first spelling", () => {
			assert.strictEqual(Range.simplify(range("^1.0.0 || >=1.0.0 <2.0.0-0")).sets.length, 1);
		});
	});
});
