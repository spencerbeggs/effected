import { assert, describe, it } from "@effect/vitest";
import { EditDistance } from "../src/index.js";

describe("EditDistance.between", () => {
	const cases: ReadonlyArray<readonly [string, string, number]> = [
		["", "", 0],
		["abc", "abc", 0],
		["", "abc", 3],
		["abc", "", 3],
		["kitten", "sitting", 3],
		["flaw", "lawn", 2],
		["stauts", "status", 2],
		["a", "b", 1],
		["Status", "status", 1],
		["intention", "execution", 5],
	];
	for (const [a, b, expected] of cases) {
		it(`${JSON.stringify(a)} to ${JSON.stringify(b)} is ${expected}`, () => {
			assert.strictEqual(EditDistance.between(a, b), expected);
			assert.strictEqual(EditDistance.between(b, a), expected);
		});
	}
});

describe("EditDistance.suggest", () => {
	it("finds the nearest candidate", () => {
		assert.deepStrictEqual(EditDistance.suggest("stauts", ["status", "stack", "build"]), ["status"]);
	});

	it("keeps ties in the order given, each once", () => {
		assert.deepStrictEqual(EditDistance.suggest("cat", ["bat", "cut", "bat", "dog"]), ["bat", "cut"]);
	});

	it("returns only an exact match when there is one", () => {
		assert.deepStrictEqual(EditDistance.suggest("cat", ["cut", "cat", "bat"]), ["cat"]);
	});

	it("is empty without candidates, or when none is close enough", () => {
		assert.deepStrictEqual(EditDistance.suggest("stauts", []), []);
		assert.deepStrictEqual(EditDistance.suggest("zzzzzz", ["status", "stack"]), []);
	});

	it("takes a number as the maximum", () => {
		assert.deepStrictEqual(EditDistance.suggest("cat", ["dog"], { maxDistance: 3 }), ["dog"]);
		assert.deepStrictEqual(EditDistance.suggest("cat", ["cut"], { maxDistance: 0 }), []);
	});

	it("resolves a function maximum from the input", () => {
		const maxDistance = (input: string): number => Math.max(2, Math.floor(input.length / 3));
		// "abcdefghi" to "abcdefXYZ" is 3 edits: admitted at 9 characters (max 3)
		assert.deepStrictEqual(EditDistance.suggest("abcdefghi", ["abcdefXYZ"], { maxDistance }), ["abcdefXYZ"]);
		// "abcdef" to "abcXYZ" is 3 edits: refused at 6 characters (max 2)
		assert.deepStrictEqual(EditDistance.suggest("abcdef", ["abcXYZ"], { maxDistance }), []);
	});

	it("throws a RangeError for a maximum that is not a non-negative integer", () => {
		assert.throws(() => EditDistance.suggest("a", ["b"], { maxDistance: () => 1.5 }), RangeError);
		assert.throws(() => EditDistance.suggest("a", ["b"], { maxDistance: -1 }), RangeError);
		assert.throws(() => EditDistance.suggest("a", ["b"], { maxDistance: Number.NaN }), RangeError);
	});
});
