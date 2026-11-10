// node-semver's view of a range: `Range.writtenSetsResult` and `Range.isAny`,
// held to node-semver itself (a devDependency, the oracle, never a runtime
// dependency). Every expected value is computed at test time from
// `new Range(input, { includePrerelease })`: its `set`, each comparator's
// `value` with the any comparator's `""` left out, and `range === ""`.
//
// One input is allowlisted by name. HYPHEN-UPPER: under `includePrerelease`,
// node-semver writes a full hyphen upper bound `1.2.3 - 2.3.4` as `<2.3.5-0`,
// where this package keeps `<=2.3.4`, as core `SemVerRange` expands it. No
// version lies between the two bounds, so both match exactly the same
// versions; only the written comparator differs.

import { createRequire } from "node:module";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { InvalidRangeError, Range, SemVer } from "../src/index.js";

/** The slice of node-semver's `Range` this test reads. */
interface NodeRange {
	readonly set: ReadonlyArray<ReadonlyArray<{ readonly value: string }>>;
	readonly range: string;
	test(version: string): boolean;
}

const nodeSemver = createRequire(import.meta.url)("semver") as {
	readonly Range: new (input: string, options: { readonly includePrerelease: boolean }) => NodeRange;
};

const node = (input: string, includePrerelease: boolean): NodeRange =>
	new nodeSemver.Range(input, { includePrerelease });

const nodeSets = (input: string, includePrerelease: boolean): ReadonlyArray<ReadonlyArray<string>> =>
	node(input, includePrerelease).set.map((set) => set.map((c) => c.value).filter((value) => value !== ""));

const INPUTS: ReadonlyArray<string> = [
	"*",
	"",
	"x",
	"^1.0.0",
	"<2.0.0 >=1.0.0",
	">=1.0.0 <2.0.0",
	"<=2.0.0 >1.0.0",
	">=0.0.0",
	">=0.0.0 <2.0.0",
	"<2.0.0 >=0.0.0",
	"* <2.0.0",
	">=0.0.0-0",
	">=0.0.0-0 <2.0.0",
	"1.2.3 - 2.3.4",
	">=1.0.0 <2.0.0 || >*",
	">*",
	">* || <*",
	"^1.0.0 || *",
	"~1.2.3 || >=0.0.0",
	">=1.0.0 >=1.0.0 <2.0.0",
	"1.2.3 =1.2.3",
	"^1.2 <1.5.0",
	"<1.5.0 ^1.2",
	"<2.0.0 >=1.0.0 || <4.0.0 >=3.0.0",
	">=1.0.0 <0.0.0-0",
	// An empty part beside `||`, which node-semver reads as `*`.
	"||*",
	"|| 1.0.0",
	"1.0.0 ||",
	"1.0.0 || || 2.0.0",
	"||",
	"^1.0.0 ||",
	"1.2.3 - 2.3.4 || ",
];

const CASES = INPUTS.flatMap((input) => [false, true].map((includePrerelease) => [input, includePrerelease] as const));

/** HYPHEN-UPPER: a full hyphen upper bound under `includePrerelease`. */
const isHyphenUpper = (input: string, includePrerelease: boolean): boolean =>
	includePrerelease && /\d - \d+\.\d+\.\d+/.test(input);

const label = (input: string, includePrerelease: boolean): string =>
	`${JSON.stringify(input)}${includePrerelease ? " (includePrerelease)" : ""}`;

const written = (input: string, includePrerelease: boolean): ReadonlyArray<ReadonlyArray<string>> =>
	Result.getOrThrow(Range.writtenSetsResult(input, { includePrerelease })).map((set) => set.map(String));

// Versions around every bound the inputs use, prereleases included.
const PROBES: ReadonlyArray<string> = [
	"0.0.0-0",
	"0.0.0",
	"1.0.0-0",
	"1.0.0",
	"1.2.3-beta",
	"1.2.3",
	"1.4.9",
	"1.5.0",
	"2.0.0-0",
	"2.0.0",
	"2.3.4-rc.1",
	"2.3.4",
	"2.3.5-0",
	"2.3.5",
	"3.5.0",
];

describe("Range.writtenSetsResult against node-semver", () => {
	for (const [input, includePrerelease] of CASES) {
		if (isHyphenUpper(input, includePrerelease)) continue;
		it(`${label(input, includePrerelease)} is node-semver's set`, () => {
			assert.deepStrictEqual(written(input, includePrerelease), nodeSets(input, includePrerelease));
		});
	}

	it("HYPHEN-UPPER: only the written upper bound differs, and both match the same versions", () => {
		const input = "1.2.3 - 2.3.4";
		assert.deepStrictEqual(nodeSets(input, true), [[">=1.2.3-0", "<2.3.5-0"]]);
		assert.deepStrictEqual(written(input, true), [[">=1.2.3-0", "<=2.3.4"]]);
		const ours = Result.getOrThrow(Range.parseResult(input, { includePrerelease: true }));
		for (const probe of PROBES) {
			assert.strictEqual(
				ours.test(Result.getOrThrow(SemVer.parseResult(probe))),
				node(input, true).test(probe),
				`${input} against ${probe}`,
			);
		}
	});

	it("keeps the written order the normalized range sorts away", () => {
		assert.deepStrictEqual(written("<2.0.0 >=1.0.0", false), nodeSets("<2.0.0 >=1.0.0", false));
		assert.deepStrictEqual(written("<2.0.0 >=1.0.0", false), [["<2.0.0", ">=1.0.0"]]);
		assert.strictEqual(Result.getOrThrow(Range.parseResult("<2.0.0 >=1.0.0")).toString(), ">=1.0.0 <2.0.0");
	});

	it("fails InvalidRangeError on input the grammar rejects", () => {
		const result = Range.writtenSetsResult("1.*.3");
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) assert.instanceOf(result.failure, InvalidRangeError);
	});

	it.effect("Range.writtenSets is the Effect form of the same answer", () =>
		Effect.gen(function* () {
			const any = yield* Range.writtenSets("<=2.0.0 >1.0.0 || *");
			assert.deepStrictEqual(any, [[]]);
			const ordered = yield* Range.writtenSets("<=2.0.0 >1.0.0");
			assert.deepStrictEqual(
				ordered.map((set) => set.map(String)),
				[["<=2.0.0", ">1.0.0"]],
			);
			const error = yield* Effect.flip(Range.writtenSets(">>1.0.0"));
			assert.instanceOf(error, InvalidRangeError);
		}),
	);
});

describe("Range.isAny against node-semver", () => {
	for (const [input, includePrerelease] of CASES) {
		it(`${label(input, includePrerelease)} is node-semver's range === "", and agrees with the written sets`, () => {
			const expected = node(input, includePrerelease).range === "";
			const range = Result.getOrThrow(Range.parseResult(input, { includePrerelease }));
			assert.strictEqual(range.isAny(), expected);
			assert.strictEqual(
				written(input, includePrerelease).some((set) => set.length === 0),
				expected,
			);
		});
	}

	it("the corpus holds both answers (control)", () => {
		const answers = new Set(CASES.map(([input, includePrerelease]) => node(input, includePrerelease).range === ""));
		assert.deepStrictEqual([...answers].sort(), [false, true]);
	});

	it("an empty || part matches what * matches, as in node-semver", () => {
		for (const input of ["||*", "1.0.0 ||", "1.0.0 || || 2.0.0"]) {
			const range = Result.getOrThrow(Range.parseResult(input));
			for (const probe of PROBES) {
				assert.strictEqual(
					range.test(Result.getOrThrow(SemVer.parseResult(probe))),
					node(input, false).test(probe),
					`${input} against ${probe}`,
				);
			}
		}
	});

	it("does not mean a prerelease satisfies the range", () => {
		const range = Result.getOrThrow(Range.parseResult("*"));
		assert.isTrue(range.isAny());
		assert.isFalse(range.test(Result.getOrThrow(SemVer.parseResult("1.0.0-beta"))));
	});
});
