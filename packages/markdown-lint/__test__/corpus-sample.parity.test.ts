// The committed corpus sample (helpers/corpus-sample.ts) is what a pull request run compares on, so it is held
// here: at every depth it must not be vacuous, and at full depth it must still cover every rule markdownlint
// reports anywhere in the corpus. A fixture the sample names and the corpus lacks never gets this far:
// `Corpus.select` refuses it when the harness loads.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { fullCorpus } from "./helpers/corpus-files.js";
import { CORPUS_SAMPLE } from "./helpers/corpus-sample.js";
import { corpus } from "./helpers/differential.js";
import { ruleCovers, uncovered } from "./helpers/sample-cover.js";

describe("the corpus sample", () => {
	it("is what the harness reads at sample depth, and the whole corpus at full depth", () => {
		assert.strictEqual(corpus.length, Depth.pick({ sample: CORPUS_SAMPLE.length, full: fullCorpus.length }));
		assert.isBelow(CORPUS_SAMPLE.length, fullCorpus.length);
		assert.deepStrictEqual([...CORPUS_SAMPLE], [...CORPUS_SAMPLE].sort());
	});

	it("has markdownlint reporting every built-in rule that reports anywhere in it", () => {
		const sample = fullCorpus.filter((entry) => CORPUS_SAMPLE.includes(entry.name));
		const reported = new Set<string>();
		for (const found of ruleCovers(sample).values()) for (const name of found) reported.add(name);
		// All 53 built-in rules report somewhere in the corpus, so all 53 must report somewhere in the sample.
		assert.strictEqual(reported.size, 53);
	});

	it("still covers every rule the full corpus reports", { timeout: 300_000 }, () => {
		Depth.whenFull(() => {
			assert.deepStrictEqual(uncovered(ruleCovers(fullCorpus), [...CORPUS_SAMPLE]), []);
		});
	});
});
