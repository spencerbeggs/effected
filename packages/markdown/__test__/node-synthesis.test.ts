// Synthesized-node construction: every node class's `make` fills the
// zero-width `Position.synthetic` when `position` is omitted, so replacement
// fragments for `MarkdownFormat.modify` construct in one line. The default is
// make-only — the controls pin that decode (the mdast admission boundary)
// still requires a full position and that parsed trees still carry real
// spans, so the interop corpus's exact-emission contract is untouched.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { Markdown } from "../src/Markdown.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { MarkdownFormat } from "../src/MarkdownFormat.js";
import { Heading, Paragraph, Point, Position, Root, Text } from "../src/MarkdownNode.js";

const parseDoc = (text: string) => {
	const result = MarkdownDocument.parseResult(text);
	assert.isTrue(Result.isSuccess(result));
	return Result.getOrThrow(result);
};

describe("Position.synthetic", () => {
	it("is the zero-width sentinel: line 1, column 1, offset 0 at both ends", () => {
		assert.instanceOf(Position.synthetic, Position);
		assert.deepStrictEqual(Position.synthetic.start, Point.make({ line: 1, column: 1, offset: 0 }));
		assert.deepStrictEqual(Position.synthetic.end, Point.make({ line: 1, column: 1, offset: 0 }));
	});
});

describe("make fills the synthetic position", () => {
	it("constructs a Text fragment in one line", () => {
		const text = Text.make({ value: "shipped" });
		assert.instanceOf(text, Text);
		assert.strictEqual(text.value, "shipped");
		assert.strictEqual(text.position, Position.synthetic);
	});

	it("constructs Paragraph and Heading fragments in one line", () => {
		const paragraph = Paragraph.make({ children: [Text.make({ value: "p" })] });
		assert.strictEqual(paragraph.position, Position.synthetic);
		const heading = Heading.make({ depth: 2, children: [Text.make({ value: "t" })] });
		assert.strictEqual(heading.depth, 2);
		assert.strictEqual(heading.position, Position.synthetic);
	});

	it("still honors an explicit position by identity", () => {
		const explicit = Position.make({
			start: Point.make({ line: 2, column: 3, offset: 9 }),
			end: Point.make({ line: 2, column: 8, offset: 14 }),
		});
		const text = Text.make({ value: "placed", position: explicit });
		assert.strictEqual(text.position, explicit);
	});
});

describe("synthesized trees flow through the render surfaces", () => {
	it("stringifies a fully synthesized tree canonically", () => {
		const root = Root.make({
			children: [
				Heading.make({ depth: 2, children: [Text.make({ value: "Title" })] }),
				Paragraph.make({ children: [Text.make({ value: "Body." })] }),
			],
		});
		const rendered = Markdown.stringifyResult(root);
		assert.isTrue(Result.isSuccess(rendered));
		const out = Result.getOrThrow(rendered);
		// Re-parses to the same shape — the canonical-stringify contract.
		const reparsed = parseDoc(out);
		assert.deepStrictEqual(
			reparsed.root.children.map((child) => child.type),
			["heading", "paragraph"],
		);
	});

	it.effect("modify accepts a one-line synthesized fragment", () =>
		Effect.gen(function* () {
			const document = parseDoc("# Old\n\nbody\n");
			const heading = document.find("heading");
			assert.isDefined(heading);
			const out = yield* MarkdownFormat.modifyToString(
				document,
				heading,
				Heading.make({ depth: 1, children: [Text.make({ value: "New" })] }),
			);
			assert.strictEqual(out, "# New\n\nbody\n");
		}),
	);
});

describe("the default is make-only (controls)", () => {
	it("decode still requires a full position", () => {
		const decoded = Schema.decodeUnknownResult(Text)({ type: "text", value: "x" });
		assert.isTrue(Result.isFailure(decoded));
	});

	it("parsed trees still carry real spans, never the sentinel", () => {
		const document = parseDoc("# Hi\n");
		const heading = document.find("heading");
		assert.isDefined(heading);
		assert.notStrictEqual(heading.position, Position.synthetic);
		assert.strictEqual(heading.position.start.offset, 0);
		assert.strictEqual(heading.position.end.offset, 4);
	});

	it("encode of a synthesized node still emits the position", () => {
		const encoded = Schema.encodeUnknownResult(Text)(Text.make({ value: "x" }));
		assert.isTrue(Result.isSuccess(encoded));
		const plain = Result.getOrThrow(encoded) as { position?: unknown };
		assert.deepStrictEqual(plain.position, {
			start: { line: 1, column: 1, offset: 0 },
			end: { line: 1, column: 1, offset: 0 },
		});
	});
});
