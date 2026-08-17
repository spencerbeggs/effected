import { assert, describe, it } from "@effect/vitest";
import type { ReferenceKeyword } from "../src/ClosingList.js";
import { REFERENCE_KEYWORDS } from "../src/ClosingList.js";
import type { ClosingKeyword } from "../src/IssueReferences.js";
import { CLOSING_KEYWORDS } from "../src/IssueReferences.js";
import type { KeywordFamily } from "../src/KeywordFamily.js";
import { keywordFamily } from "../src/KeywordFamily.js";

// Pure functions get pure tests, with no layer at all.

describe("KeywordFamily.keywordFamily", () => {
	it("maps all twelve keywords — the projection is exhaustive", () => {
		// One row per keyword, spelled out: the test restates the table so a
		// drifted entry in the source record fails loudly, keyword by keyword.
		const expected: ReadonlyArray<readonly [ClosingKeyword | ReferenceKeyword, KeywordFamily]> = [
			["close", "close"],
			["closes", "close"],
			["closed", "close"],
			["fix", "fix"],
			["fixes", "fix"],
			["fixed", "fix"],
			["resolve", "resolve"],
			["resolves", "resolve"],
			["resolved", "resolve"],
			["ref", "ref"],
			["refs", "ref"],
			["references", "ref"],
		];
		assert.deepStrictEqual(
			expected.map(([keyword]) => keyword),
			[...CLOSING_KEYWORDS, ...REFERENCE_KEYWORDS],
		);
		for (const [keyword, family] of expected) {
			assert.strictEqual(keywordFamily(keyword), family, keyword);
		}
	});

	it("collapses each closing conjugation to its stem", () => {
		for (const keyword of CLOSING_KEYWORDS) {
			const family = keywordFamily(keyword);
			assert.isTrue(keyword.startsWith(family), keyword);
			assert.notStrictEqual(family, "ref", keyword);
		}
	});

	it("maps every reference keyword to the ref family", () => {
		for (const keyword of REFERENCE_KEYWORDS) {
			assert.strictEqual(keywordFamily(keyword), "ref", keyword);
		}
	});
});
