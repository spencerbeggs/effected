import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import { Corpus } from "../src/index.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

const all = [{ name: "a" }, { name: "b" }, { name: "c" }];

describe("Corpus.select", () => {
	it("returns every entry at full depth", () => {
		assert.deepStrictEqual(Corpus.select(all, { sample: ["b"], depth: "full" }), all);
	});

	it("returns the named entries at sample depth, in corpus order", () => {
		assert.deepStrictEqual(Corpus.select(all, { sample: ["c", "a"], depth: "sample" }), [{ name: "a" }, { name: "c" }]);
	});

	// A fixture renamed or deleted upstream must fail the pull request run, whatever the depth.
	it("refuses a sample name the corpus lacks, at both depths", () => {
		for (const depth of ["sample", "full"] as const) {
			assert.throws(() => Corpus.select(all, { sample: ["a", "gone.md"], depth }), /gone\.md/);
		}
	});

	it("refuses an empty sample and a duplicated name", () => {
		assert.throws(() => Corpus.select(all, { sample: [], depth: "sample" }), /empty/);
		assert.throws(() => Corpus.select(all, { sample: ["a", "a"], depth: "sample" }), /duplicate/i);
	});

	it("reads the depth from the environment when none is given", () => {
		vi.stubEnv("EFFECTED_TEST_DEPTH", "full");
		assert.lengthOf(Corpus.select(all, { sample: ["b"] }), 3);
		vi.stubEnv("EFFECTED_TEST_DEPTH", "sample");
		assert.lengthOf(Corpus.select(all, { sample: ["b"] }), 1);
	});
});

describe("Corpus.pin", () => {
	it("pins exactly at full depth and not at all at sample depth", () => {
		assert.throws(() => Corpus.pin(3, 4, { depth: "full", label: "MD009" }), /MD009/);
		Corpus.pin(4, 4, { depth: "full" });
		Corpus.pin(3, 4, { depth: "sample" });
	});

	it("reads the depth from the environment when none is given", () => {
		vi.stubEnv("EFFECTED_TEST_DEPTH", "full");
		assert.throws(() => Corpus.pin(3, 4));
		vi.stubEnv("EFFECTED_TEST_DEPTH", "sample");
		Corpus.pin(3, 4);
	});
});
