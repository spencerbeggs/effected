// The selection behind the committed corpus sample: a greedy set cover, so a fixed, small list of fixtures still
// has every rule reporting somewhere.

import { assert, describe, it } from "@effect/vitest";
import { chooseCover, ruleCovers, uncovered } from "./helpers/sample-cover.js";

const covers = new Map<string, ReadonlySet<string>>([
	["a.md", new Set(["MD001", "MD002"])],
	["b.md", new Set(["MD002", "MD003"])],
	["c.md", new Set(["MD003"])],
	["d.md", new Set<string>()],
]);

describe("chooseCover", () => {
	it("covers every key with the fewest entries", () => {
		assert.deepStrictEqual(chooseCover(covers), ["a.md", "b.md"]);
	});

	it("breaks a tie by name", () => {
		assert.deepStrictEqual(
			chooseCover(
				new Map([
					["z.md", new Set(["k"])],
					["y.md", new Set(["k"])],
				]),
			),
			["y.md"],
		);
	});

	it("takes the entry covering the most keys first, then what is left", () => {
		assert.deepStrictEqual(
			chooseCover(
				new Map([
					["one.md", new Set(["a"])],
					["two.md", new Set(["b"])],
					["wide.md", new Set(["a", "b", "c"])],
					["d.md", new Set(["d"])],
				]),
			),
			["d.md", "wide.md"],
		);
	});

	it("chooses nothing when nothing is covered", () => {
		assert.deepStrictEqual(chooseCover(new Map([["d.md", new Set<string>()]])), []);
	});
});

describe("uncovered", () => {
	it("reports what a chosen set leaves uncovered, sorted", () => {
		assert.deepStrictEqual(uncovered(covers, ["a.md"]), ["MD003"]);
		assert.deepStrictEqual(uncovered(covers, ["c.md"]), ["MD001", "MD002"]);
		assert.deepStrictEqual(uncovered(covers, ["a.md", "c.md"]), []);
	});

	it("ignores a chosen name the map does not have", () => {
		assert.deepStrictEqual(uncovered(covers, ["gone.md", "a.md", "b.md"]), []);
	});
});

describe("ruleCovers", () => {
	it("maps a fixture to the rules markdownlint reports for it, over LF and CRLF", () => {
		const found = ruleCovers([
			{ name: "trailing.md", source: "# Title\n\ntext with trailing spaces   \n" },
			{ name: "clean.md", source: "# Title\n\ntext\n" },
		]);
		assert.deepStrictEqual([...(found.get("trailing.md") ?? [])], ["MD009"]);
		assert.deepStrictEqual([...(found.get("clean.md") ?? [])], []);
	});
});
