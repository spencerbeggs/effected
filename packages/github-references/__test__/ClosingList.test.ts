import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { REFERENCE_KEYWORDS, parseClosingList, parseReferenceList } from "../src/ClosingList.js";
import { CLOSING_KEYWORDS } from "../src/IssueReferences.js";

// Pure functions get pure tests, with no layer at all.

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

describe("ClosingList.parseClosingList", () => {
	it("exports exactly the three reference keywords", () => {
		assert.deepStrictEqual([...REFERENCE_KEYWORDS], ["ref", "refs", "references"]);
	});

	it("accepts every closing keyword, with and without the colon", () => {
		for (const keyword of CLOSING_KEYWORDS) {
			for (const line of [`${keyword} #7`, `${keyword}: #7`]) {
				const parsed = parseClosingList(line);
				assert.isTrue(Option.isSome(parsed), line);
				const list = Option.getOrThrow(parsed);
				assert.strictEqual(list.keyword, keyword, line);
				assert.deepStrictEqual([...list.issueNumbers], [7], line);
			}
		}
	});

	it("lowercases the keyword to canonical form, whatever the case", () => {
		for (const line of ["CLOSES: #1, #2", "Closes: #1, #2", "cLoSeS #1, #2"]) {
			const list = Option.getOrThrow(parseClosingList(line));
			assert.strictEqual(list.keyword, "closes", line);
			assert.deepStrictEqual([...list.issueNumbers], [1, 2], line);
		}
	});

	it("parses a comma list, an and list, the Oxford comma, and a mix", () => {
		const cases: ReadonlyArray<readonly [string, ReadonlyArray<number>]> = [
			["Closes: #1, #2, #3", [1, 2, 3]],
			["Closes #1 and #2", [1, 2]],
			["Closes: #1, #2, and #3", [1, 2, 3]],
			["fixes #1, #2 and #3", [1, 2, 3]],
		];
		for (const [line, expected] of cases) {
			const parsed = parseClosingList(line);
			assert.isTrue(Option.isSome(parsed), line);
			assert.deepStrictEqual([...Option.getOrThrow(parsed).issueNumbers], expected, line);
		}
	});

	it("keeps duplicates, in line order — dedup is the caller's business", () => {
		const list = Option.getOrThrow(parseClosingList("closes #1, #1, and #2"));
		assert.deepStrictEqual([...list.issueNumbers], [1, 1, 2]);
	});

	it("trims surrounding whitespace before parsing", () => {
		const list = Option.getOrThrow(parseClosingList("   Closes: #12, #13\t "));
		assert.deepStrictEqual([...list.issueNumbers], [12, 13]);
	});

	it("rejects everything that is not exactly one whole-line list", () => {
		const negatives = [
			"Closes: 123", // the # is mandatory
			"closes #1 because reasons", // trailing prose after the list
			"see closes #1", // leading prose
			"closes #1, #2 done", // trailing prose after a longer list
			"closes #1, and", // Oxford comma with no final item
			"closes #1 and", // dangling and
			"closes #1,", // dangling comma
			"closes:#1", // colon without the mandatory space
			"closes#1", // no separator at all
			"closes", // keyword without a list
			"closes\n#1", // an embedded newline means this was never one line
			"closes #1,\n#2", // ...even between items
			"closes #1 android #2", // and must stand alone
			"closes owner/repo#3", // cross-repo is out of scope
			"#1, #2", // no keyword
			"", // an empty line carries nothing
			"complete garbage", // not the grammar at all
		];
		for (const line of negatives) assert.isTrue(Option.isNone(parseClosingList(line)), line);
	});

	it("rejects the WHOLE line when any item exceeds Number.MAX_SAFE_INTEGER", () => {
		// Contrast the harvest dialect, which skips the one bad match: a list is
		// a single claim about a set of issues, and a partial list misrepresents.
		assert.isTrue(Option.isNone(parseClosingList("closes #1, #9007199254740993, #2")));
		assert.isTrue(Option.isNone(parseClosingList("closes #9007199254740993")));
	});

	it("keeps Number.MAX_SAFE_INTEGER itself — the guard is strict, not fuzzy", () => {
		const list = Option.getOrThrow(parseClosingList(`closes #${Number.MAX_SAFE_INTEGER}`));
		assert.deepStrictEqual([...list.issueNumbers], [Number.MAX_SAFE_INTEGER]);
	});

	it("returns none for a Refs line — reference keywords are not closing", () => {
		for (const keyword of REFERENCE_KEYWORDS) {
			assert.isTrue(Option.isNone(parseClosingList(`${keyword}: #1, #2`)), keyword);
		}
	});
});

describe("ClosingList.parseReferenceList", () => {
	it("accepts a reference-keyword line and reports closing: false", () => {
		for (const keyword of REFERENCE_KEYWORDS) {
			for (const line of [`${keyword} #7`, `${keyword}: #7, #8`, `${capitalized(keyword)}: #7`]) {
				const parsed = parseReferenceList(line);
				assert.isTrue(Option.isSome(parsed), line);
				const list = Option.getOrThrow(parsed);
				assert.strictEqual(list.keyword, keyword, line);
				assert.isFalse(list.closing, line);
			}
		}
	});

	it("accepts every closing keyword too, and reports closing: true", () => {
		for (const keyword of CLOSING_KEYWORDS) {
			const list = Option.getOrThrow(parseReferenceList(`${keyword}: #1 and #2`));
			assert.strictEqual(list.keyword, keyword);
			assert.isTrue(list.closing);
			assert.deepStrictEqual([...list.issueNumbers], [1, 2]);
		}
	});

	it("shares the closing dialect's rejections", () => {
		const negatives = [
			"refs: 123", // the # is mandatory
			"refs #1 trailing", // trailing prose
			"refs\n#1", // embedded newline
			"refs #9007199254740993", // unsafe integer rejects the whole line
			"reference #1", // not a listed keyword spelling
			"", // an empty line carries nothing
		];
		for (const line of negatives) assert.isTrue(Option.isNone(parseReferenceList(line)), line);
	});
});
