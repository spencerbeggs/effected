// PositionMapping: kit offsets to markdownlint's 1-based coordinates. Each
// case names the markdown shape that makes the mapping non-trivial — setext
// headings, multi-line nodes, frontmatter, CRLF, astral characters — and
// pins it through a parsed tree, not a hand-picked offset, where it can.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownEdit } from "@effected/markdown";
import { Option, Result } from "effect";
import { LintFixInfo } from "../src/LintDiagnostic.js";
import { PositionMapping } from "../src/PositionMapping.js";

const document = (source: string) => {
	const result = MarkdownDocument.parseResult(source, { frontmatter: true });
	assert.isTrue(Result.isSuccess(result));
	return Result.getOrThrow(result);
};

describe("PositionMapping", () => {
	it("reports a setext heading on its text line, as markdownlint's setextHeading token starts", () => {
		const doc = document("Intro\n\nTitle\n=====\n\nAfter\n");
		const mapping = PositionMapping.fromDocument(doc);
		const heading = Option.getOrThrow(doc.find("heading"));
		assert.strictEqual(mapping.nodeLineNumber(heading), 3);
		assert.strictEqual(mapping.column(heading.position.start.offset), 1);
		// The span runs onto the underline; the range stops at the text line's end.
		assert.deepStrictEqual(
			mapping.range({
				offset: heading.position.start.offset,
				length: heading.position.end.offset - heading.position.start.offset,
			}),
			Option.some([1, 5] as const),
		);
	});

	it("clamps a multi-line node's range to its first line", () => {
		const doc = document("para line one\nline two\nline three\n");
		const mapping = PositionMapping.fromDocument(doc);
		const paragraph = Option.getOrThrow(doc.find("paragraph"));
		const span = {
			offset: paragraph.position.start.offset,
			length: paragraph.position.end.offset - paragraph.position.start.offset,
		};
		assert.isAbove(span.length, "para line one".length);
		assert.deepStrictEqual(mapping.range(span), Option.some([1, 13] as const));
	});

	it("numbers lines after a frontmatter block as an editor shows them", () => {
		const doc = document("---\ntitle: x\n---\n\n# Body\n");
		const mapping = PositionMapping.fromDocument(doc);
		const heading = Option.getOrThrow(doc.find("heading"));
		assert.strictEqual(mapping.nodeLineNumber(heading), 5);
	});

	it("treats \\r\\n as one terminator, and an offset on its \\n as the line's end", () => {
		const mapping = PositionMapping.of("ab\r\ncd\r\n");
		assert.strictEqual(mapping.lineNumber(4), 2);
		assert.strictEqual(mapping.column(4), 1);
		assert.strictEqual(mapping.lineNumber(3), 1);
		assert.strictEqual(mapping.column(3), 3);
		assert.isTrue(Option.isNone(mapping.range({ offset: 3, length: 1 })));
		assert.deepStrictEqual(mapping.lines(), ["ab", "cd", ""]);
	});

	it("splits lines exactly as markdownlint does: \\r\\n, a bare \\r and \\n", () => {
		assert.deepStrictEqual(PositionMapping.of("a\r\nb\rc\nd").lines(), "a\r\nb\rc\nd".split(/\r\n?|\n/));
	});

	it("counts columns in UTF-16 code units, as markdownlint's string indexes do", () => {
		const mapping = PositionMapping.of("😀 x\n");
		// The emoji is two code units, so "x" sits at column 4.
		assert.strictEqual(mapping.column(3), 4);
		assert.deepStrictEqual(mapping.range({ offset: 3, length: 1 }), Option.some([4, 1] as const));
	});

	it("has no range for an empty span or one starting at a line's end", () => {
		const mapping = PositionMapping.of("abc\ndef\n");
		assert.isTrue(Option.isNone(mapping.range({ offset: 1, length: 0 })));
		assert.isTrue(Option.isNone(mapping.range({ offset: 3, length: 4 })));
		assert.deepStrictEqual(mapping.range({ offset: 2, length: 9 }), Option.some([3, 1] as const));
	});

	it("cuts a span to a named line: the part on it, or nothing when the span lies elsewhere", () => {
		// Line 1 "# H" (0-3), line 2 "" (4), line 3 "A much longer line" (5-23).
		const mapping = PositionMapping.of("# H\n\nA much longer line\n");
		// Wholly on line 3, asked for line 1: no range (markdownlint would throw on [11, 5] there).
		assert.isTrue(Option.isNone(mapping.range({ offset: 15, length: 5 }, 1)));
		// The same span on its own line.
		assert.deepStrictEqual(mapping.range({ offset: 15, length: 5 }, 3), Option.some([11, 5] as const));
		// A span starting on line 1 and reaching line 3 keeps line 3's part.
		assert.deepStrictEqual(mapping.range({ offset: 1, length: 10 }, 3), Option.some([1, 6] as const));
		// A line past the source has no range.
		assert.isTrue(Option.isNone(mapping.range({ offset: 0, length: 2 }, 9)));
	});

	describe("fixInfo", () => {
		const source = "first\nsecond line\nthird\n";
		const mapping = PositionMapping.of(source);

		it("maps a replacement within one line, omitting lineNumber when it is the diagnostic's line", () => {
			assert.deepStrictEqual(
				mapping.fixInfo({ offset: 13, length: 4, content: "LINE" }, 2),
				Option.some(LintFixInfo.make({ editColumn: 8, deleteCount: 4, insertText: "LINE" })),
			);
		});

		it("names the line when the fix lands elsewhere", () => {
			assert.deepStrictEqual(
				mapping.fixInfo({ offset: 0, length: 0, content: "> " }, 3),
				Option.some(LintFixInfo.make({ lineNumber: 1, editColumn: 1, insertText: "> " })),
			);
		});

		it("maps a pure deletion with no insertText", () => {
			assert.deepStrictEqual(
				mapping.fixInfo({ offset: 6, length: 7, content: "" }, 2),
				Option.some(LintFixInfo.make({ editColumn: 1, deleteCount: 7 })),
			);
		});

		it("maps a whole-line delete, terminator included, to deleteCount -1", () => {
			assert.deepStrictEqual(
				mapping.fixInfo({ offset: 6, length: 12, content: "" }, 2),
				Option.some(LintFixInfo.make({ deleteCount: -1 })),
			);
			const crlf = PositionMapping.of("a\r\nb\r\n");
			assert.deepStrictEqual(
				crlf.fixInfo({ offset: 0, length: 3, content: "" }, 1),
				Option.some(LintFixInfo.make({ deleteCount: -1 })),
			);
		});

		it("has no fixInfo for an edit crossing a line break, starting inside \\r\\n, or changing nothing", () => {
			assert.isTrue(Option.isNone(mapping.fixInfo({ offset: 3, length: 5, content: "" }, 1)));
			assert.isTrue(Option.isNone(mapping.fixInfo({ offset: 4, length: 2, content: "x" }, 1)));
			assert.isTrue(Option.isNone(mapping.fixInfo({ offset: 2, length: 0, content: "" }, 1)));
			assert.isTrue(Option.isNone(PositionMapping.of("a\r\nb").fixInfo({ offset: 2, length: 1, content: "" }, 1)));
		});

		it("deleting the last line's text, with no terminator after it, is a plain delete", () => {
			assert.deepStrictEqual(
				PositionMapping.of("a\nlast").fixInfo({ offset: 2, length: 4, content: "" }, 2),
				Option.some(LintFixInfo.make({ editColumn: 1, deleteCount: 4 })),
			);
		});
	});

	it("copies a plain edit literal into a MarkdownEdit and passes an instance through", () => {
		const edit = MarkdownEdit.make({ offset: 1, length: 2, content: "x" });
		assert.strictEqual(PositionMapping.edit(edit), edit);
		assert.deepStrictEqual(PositionMapping.edit({ offset: 1, length: 2, content: "x" }), edit);
	});

	it("reads lineCount and lineText, clamping a line past the end", () => {
		const mapping = PositionMapping.of("a\nb");
		assert.strictEqual(mapping.lineCount, 2);
		assert.strictEqual(mapping.lineText(2), "b");
		assert.strictEqual(mapping.lineText(9), "b");
	});
});
