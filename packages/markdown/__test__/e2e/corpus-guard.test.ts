// The silently-empty-walk guard (toml precedent): asserts the vendored
// corpora actually loaded their full expected counts before any conformance
// harness is built on top of them. A regenerated or truncated spec.json, or
// an accidentally-emptied pathological case list, fails loudly here instead
// of silently passing zero-example test suites downstream.

import { assert, describe, it } from "@effect/vitest";
import { loadSpecExamples } from "./support/corpus.js";
import { PATHOLOGICAL_CASES } from "./support/pathological/cases.js";

// The CommonMark 0.31.2 spec embeds exactly 652 conformance examples.
const SPEC_EXAMPLE_COUNT = 652;

// The cmark-gfm pathological suite minus the GFM-only "tables" case and the
// upstream-disabled "many references" case (see support/pathological/VENDORED.md).
const MIN_PATHOLOGICAL_CASE_COUNT = 20;

describe("conformance corpus guard", () => {
	it("loads exactly the 652-example CommonMark spec corpus", () => {
		assert.strictEqual(loadSpecExamples().length, SPEC_EXAMPLE_COUNT);
	});

	it("loads at least 20 pathological cases", () => {
		assert.isAtLeast(PATHOLOGICAL_CASES.length, MIN_PATHOLOGICAL_CASE_COUNT);
	});
});
