import { assert, describe, it } from "@effect/vitest";
import { parseBlocks } from "../src/internal/blockParser.js";
import { columnsToNextTabStop, preprocessLines, replaceNul } from "../src/internal/preprocess.js";

/** Slice the source back out of a node's position — the offset round trip. */
const sliceOf = (source: string, node: { readonly position: { start: { offset: number }; end: { offset: number } } }) =>
	source.slice(node.position.start.offset, node.position.end.offset);

describe("preprocess", () => {
	describe("line splitting", () => {
		it("keeps each line's absolute start offset", () => {
			const lines = preprocessLines("abc\ndef\nghi");
			assert.deepStrictEqual(
				lines.map((line) => [line.text, line.start]),
				[
					["abc", 0],
					["def", 4],
					["ghi", 8],
				],
			);
		});

		it("treats CRLF as one boundary and keeps offsets in the original text", () => {
			const lines = preprocessLines("abc\r\ndef\rghi\n");
			assert.deepStrictEqual(
				lines.map((line) => [line.text, line.start]),
				[
					["abc", 0],
					["def", 5],
					["ghi", 9],
				],
			);
		});

		it("does not invent a final empty line for a trailing newline", () => {
			assert.deepStrictEqual(
				preprocessLines("foo\n").map((line) => line.text),
				["foo"],
			);
		});

		it("yields one empty line for empty input", () => {
			assert.deepStrictEqual(
				preprocessLines("").map((line) => [line.text, line.start]),
				[["", 0]],
			);
		});

		it("replaces U+0000 with U+FFFD without moving any offset", () => {
			const source = "a\u0000b\nc";
			const lines = preprocessLines(source);
			assert.strictEqual(lines[0]?.text, "a\uFFFDb");
			assert.strictEqual(lines[0]?.text.length, 3);
			assert.strictEqual(lines[1]?.start, 4);
			assert.strictEqual(replaceNul("no nulls here"), "no nulls here");
		});
	});

	describe("tab stops", () => {
		it("expands a tab to the next multiple of four columns", () => {
			assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(columnsToNextTabStop), [4, 3, 2, 1, 4, 3]);
		});
	});
});

describe("block pass", () => {
	describe("tabs", () => {
		it("treats a leading tab as four columns of code indentation", () => {
			const { root } = parseBlocks("\tfoo\n");
			const [code] = root.children;
			assert.strictEqual(code?.type, "code");
			assert.strictEqual(code.type === "code" ? code.value : "", "foo\n");
		});

		it("reads a tab and four spaces as the same code indent", () => {
			// A tab at column 0 spans columns 1-4, which the code indent
			// consumes exactly. Partially consumed tabs need a container prefix
			// to straddle, so they arrive with blockquotes and lists in Task 7.
			const { root } = parseBlocks("    foo\n\tbar\n");
			const [code] = root.children;
			assert.strictEqual(code?.type === "code" ? code.value : "", "foo\nbar\n");
		});

		it("counts a tab inside an ATX heading as content, not indentation", () => {
			const { root } = parseBlocks("#\tfoo\n");
			const [heading] = root.children;
			assert.strictEqual(heading?.type, "heading");
			assert.strictEqual(heading.type === "heading" ? heading.depth : 0, 1);
		});
	});

	describe("construct precedence", () => {
		it("prefers a thematic break to a paragraph line", () => {
			const { root } = parseBlocks("***\n");
			assert.strictEqual(root.children[0]?.type, "thematicBreak");
		});

		it("prefers an ATX heading to a paragraph line", () => {
			const { root } = parseBlocks("# heading\n");
			assert.strictEqual(root.children[0]?.type, "heading");
		});

		it("does not open indented code inside a paragraph", () => {
			// An indented line after a paragraph is a lazy continuation, never
			// a code block — the `tip.type !== "paragraph"` guard in the start.
			const { root } = parseBlocks("foo\n    bar\n");
			assert.strictEqual(root.children.length, 1);
			assert.strictEqual(root.children[0]?.type, "paragraph");
		});

		it("does not open an ATX heading at four columns of indentation", () => {
			const { root } = parseBlocks("    # not a heading\n");
			assert.strictEqual(root.children[0]?.type, "code");
		});
	});

	describe("fidelity fields", () => {
		it("marks an ATX heading with its style and depth", () => {
			const { root } = parseBlocks("### three\n");
			const [heading] = root.children;
			assert.strictEqual(heading?.type, "heading");
			if (heading?.type !== "heading") {
				return;
			}
			assert.strictEqual(heading.depth, 3);
			assert.strictEqual(heading.headingStyle, "atx");
		});

		it("records the character a thematic break was drawn with", () => {
			for (const [source, marker] of [
				["---\n", "-"],
				["___\n", "_"],
				["***\n", "*"],
			] as const) {
				const [node] = parseBlocks(source).root.children;
				assert.strictEqual(node?.type === "thematicBreak" ? node.markerChar : undefined, marker);
			}
		});

		it("leaves fence fields genuinely absent on indented code", () => {
			const [code] = parseBlocks("    x = 1\n").root.children;
			assert.strictEqual(code?.type, "code");
			assert.isFalse(Object.hasOwn(code ?? {}, "fenceChar"));
			assert.isFalse(Object.hasOwn(code ?? {}, "fenceLength"));
			assert.isFalse(Object.hasOwn(code ?? {}, "lang"));
			assert.isFalse(Object.hasOwn(code ?? {}, "meta"));
		});
	});

	describe("positions", () => {
		it("spans exactly the source each block was built from", () => {
			const source = "# Title\n\nHello\nworld\n";
			const { root } = parseBlocks(source);
			const [heading, paragraph] = root.children;

			assert.strictEqual(sliceOf(source, heading as never), "# Title");
			assert.strictEqual(sliceOf(source, paragraph as never), "Hello\nworld");
		});

		it("pulls an indented code block's end back past its trailing blank lines", () => {
			const source = "    foo\n\n\nbar\n";
			const { root } = parseBlocks(source);
			const [code] = root.children;
			assert.strictEqual(code?.type, "code");
			assert.strictEqual(sliceOf(source, code as never), "foo");
			assert.strictEqual(code?.type === "code" ? code.value : "", "foo\n");
		});

		it("gives every point 1-based line and column with a 0-based offset", () => {
			const source = "# Title\n\nHello\n";
			const { root } = parseBlocks(source);
			const paragraph = root.children[1];
			assert.deepStrictEqual({ ...paragraph?.position.start }, { line: 3, column: 1, offset: 9 });
			assert.deepStrictEqual({ ...paragraph?.position.end }, { line: 3, column: 6, offset: 14 });
		});

		it("keeps offsets monotonic and inside the source for every node", () => {
			const source = "# a\n\ntext one\ntext two\n\n    code\n\n***\n\n# b\n";
			const { root } = parseBlocks(source);
			const check = (node: { position: { start: { offset: number }; end: { offset: number } } }): void => {
				assert.isAtLeast(node.position.start.offset, 0);
				assert.isAtMost(node.position.start.offset, node.position.end.offset);
				assert.isAtMost(node.position.end.offset, source.length);
			};
			check(root);
			for (const child of root.children) {
				check(child);
			}
		});
	});

	describe("raw inline slices", () => {
		it("emits one slice per leaf, pointing at the node that will own it", () => {
			const source = "# Title\n\nHello\nworld\n";
			const { root, rawInlines } = parseBlocks(source);
			const [heading, paragraph] = root.children;

			assert.strictEqual(rawInlines.length, 2);
			assert.strictEqual(rawInlines[0]?.parent, heading);
			assert.strictEqual(rawInlines[0]?.text, "Title");
			assert.strictEqual(rawInlines[1]?.parent, paragraph);
			assert.strictEqual(rawInlines[1]?.text, "Hello\nworld");
		});

		it("maps every segment back to the source it was copied from", () => {
			const source = "Hello\nworld\n";
			const { rawInlines } = parseBlocks(source);
			const slice = rawInlines[0];
			assert.isDefined(slice);
			assert.strictEqual(slice?.startOffset, 0);
			for (const segment of slice?.segments ?? []) {
				assert.strictEqual(
					slice?.text.slice(segment.textOffset, segment.textOffset + segment.length),
					source.slice(segment.sourceOffset, segment.sourceOffset + segment.length),
				);
			}
		});

		it("keeps a soft line break as a literal newline in the raw text", () => {
			const { rawInlines } = parseBlocks("aaa\nbbb\n");
			assert.strictEqual(rawInlines[0]?.text, "aaa\nbbb");
		});

		it("emits no slice for a code block", () => {
			const { rawInlines } = parseBlocks("    code\n");
			assert.strictEqual(rawInlines.length, 0);
		});
	});

	describe("documents", () => {
		it("parses an empty document to an empty root", () => {
			const { root, rawInlines, carriers } = parseBlocks("");
			assert.strictEqual(root.type, "root");
			assert.strictEqual(root.children.length, 0);
			assert.strictEqual(rawInlines.length, 0);
			assert.strictEqual(carriers.length, 0);
		});

		it("parses a blank-line-only document to an empty root", () => {
			assert.strictEqual(parseBlocks("\n\n \n\t\n").root.children.length, 0);
		});

		it("separates paragraphs at blank lines", () => {
			const { root } = parseBlocks("one\n\ntwo\n");
			assert.deepStrictEqual(
				root.children.map((child) => child.type),
				["paragraph", "paragraph"],
			);
		});
	});
});
