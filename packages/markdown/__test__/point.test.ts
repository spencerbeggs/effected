import { assert, describe, it } from "@effect/vitest";
import { LineIndex } from "@effected/source";
import { Result } from "effect";
import { pointAt } from "../src/internal/point.js";
import { Markdown } from "../src/Markdown.js";

// `pointAt` is the one place a unist Point is computed: `@effected/source`'s
// zero-based `LineIndex` line plus one, and the offset's distance from that
// line's start plus one, with the offset carried alongside.
const at = (text: string, offset: number) => {
	const { line, column } = pointAt(LineIndex.make(text), offset);
	return { line, column };
};

describe("pointAt", () => {
	it("positions the only offset of an empty string at line 1 column 1", () => {
		assert.deepStrictEqual(at("", 0), { line: 1, column: 1 });
	});

	it("carries the offset it was asked about", () => {
		assert.strictEqual(pointAt(LineIndex.make("ab\ncd"), 4).offset, 4);
	});

	it("positions offsets around \\n boundaries", () => {
		// "ab\ncd\nef"
		//  01 2 34 5 67
		const text = "ab\ncd\nef";
		assert.deepStrictEqual(at(text, 0), { line: 1, column: 1 }); // 'a'
		assert.deepStrictEqual(at(text, 1), { line: 1, column: 2 }); // 'b'
		assert.deepStrictEqual(at(text, 2), { line: 1, column: 3 }); // '\n' itself
		assert.deepStrictEqual(at(text, 3), { line: 2, column: 1 }); // 'c'
		assert.deepStrictEqual(at(text, 6), { line: 3, column: 1 }); // 'e'
	});

	it("treats a CRLF pair as one boundary and a bare CR as a break", () => {
		// "ab\r\ncd\ref"
		//  01 2 3 45 6 78
		const text = "ab\r\ncd\ref";
		assert.deepStrictEqual(at(text, 2), { line: 1, column: 3 }); // '\r'
		assert.deepStrictEqual(at(text, 4), { line: 2, column: 1 }); // 'c'
		assert.deepStrictEqual(at(text, 7), { line: 3, column: 1 }); // 'e', after the bare '\r'
	});

	it("counts the \\n of a CRLF as one column past the \\r, as vfile-location does", () => {
		// Unlike LineIndex.positionAt, which reads it as the end of its line.
		// Node positions land there: an empty list item before a CRLF ends at
		// its \n, so the positionAt form would move published positions.
		assert.deepStrictEqual(at("ab\r\ncd", 3), { line: 1, column: 4 });
	});

	it("keeps an empty list item before a CRLF at the column it always had", () => {
		const result = Markdown.parseResult("*\r\na");
		assert.isTrue(Result.isSuccess(result));
		const list = Result.isSuccess(result) ? result.success.children[0] : undefined;
		assert.strictEqual(list?.type, "list");
		assert.deepStrictEqual({ ...list?.position.end }, { line: 1, column: 3, offset: 2 });
	});

	it("places the end of a text ending in a newline on the phantom last line", () => {
		// unist point mapping (vfile, mdast-util) puts the end-of-input offset
		// at `line N+1, column 1`; only the root's end point sits there.
		assert.deepStrictEqual(at("a\n", 2), { line: 2, column: 1 });
		assert.deepStrictEqual(at("a\r\n", 3), { line: 2, column: 1 });
	});

	it("positions the final character and the one-past-end position", () => {
		assert.deepStrictEqual(at("hello", 4), { line: 1, column: 5 }); // 'o'
		assert.deepStrictEqual(at("hello", 5), { line: 1, column: 6 }); // one past end
	});

	it("counts a surrogate pair as two UTF-16 columns", () => {
		assert.deepStrictEqual(at("\u{1F600}x", 2), { line: 1, column: 3 });
	});
});
