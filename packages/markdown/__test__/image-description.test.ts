// An image's description (effected#1416): the inline content between its brackets, which the tree flattens to
// `alt`. `MarkdownDocument.imageDescription` returns it as positioned phrasing nodes, a nested image a leaf whose own
// description the same lookup returns, without changing the tree.

import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import type { Image, ImageReference, MarkdownNode, PhrasingContent } from "../src/MarkdownNode.js";

const parse = (source: string): MarkdownDocument => Result.getOrThrow(MarkdownDocument.parseResult(source));

const firstImage = (document: MarkdownDocument): Image | ImageReference => {
	const [image] = document.findAll((node) => node.type === "image" || node.type === "imageReference");
	assert.isDefined(image);
	return image as Image | ImageReference;
};

const described = (document: MarkdownDocument, image: Image | ImageReference): ReadonlyArray<PhrasingContent> =>
	Option.getOrThrow(document.imageDescription(image));

// Each node as its type and the source it spans.
const spans = (source: string, nodes: ReadonlyArray<MarkdownNode>): ReadonlyArray<readonly [string, string]> =>
	nodes.map((node) => [node.type, source.slice(node.position.start.offset, node.position.end.offset)] as const);

describe("MarkdownDocument.imageDescription", () => {
	it("returns an image's bracket content as positioned nodes, and keeps its alt", () => {
		const source = "a ![b *c* `d` [e](f)](g.png)\n";
		const document = parse(source);
		const image = firstImage(document);
		assert.strictEqual(image.alt, "b c d e");
		assert.deepStrictEqual(spans(source, described(document, image)), [
			["text", "b "],
			["emphasis", "*c*"],
			["text", " "],
			["inlineCode", "`d`"],
			["text", " "],
			["link", "[e](f)"],
		]);
	});

	it("reads a chain of nested images one level at a time", () => {
		const source = "![a ![b ![c](x)](y)](z)\n";
		const document = parse(source);
		const outer = firstImage(document);
		const first = described(document, outer);
		assert.deepStrictEqual(spans(source, first), [
			["text", "a "],
			["image", "![b ![c](x)](y)"],
		]);
		const middle = first[1] as Image;
		const second = described(document, middle);
		assert.deepStrictEqual(spans(source, second), [
			["text", "b "],
			["image", "![c](x)"],
		]);
		assert.deepStrictEqual(spans(source, described(document, second[1] as Image)), [["text", "c"]]);
	});

	it("describes an image reference and an empty label", () => {
		const source = "![*a*][r] ![](u)\n\n[r]: v\n";
		const document = parse(source);
		const [reference, empty] = document.findAll(
			(node) => node.type === "image" || node.type === "imageReference",
		) as ReadonlyArray<Image | ImageReference>;
		assert.deepStrictEqual(spans(source, described(document, reference as ImageReference)), [["emphasis", "*a*"]]);
		assert.deepStrictEqual(described(document, empty as Image), []);
	});

	it("positions a description inside a blockquote in the original source", () => {
		const source = "> ![a\n> *b*](c)\n";
		const document = parse(source);
		const nodes = described(document, firstImage(document));
		const emphasis = nodes.find((node) => node.type === "emphasis");
		assert.isDefined(emphasis);
		assert.strictEqual(source.slice(emphasis.position.start.offset, emphasis.position.end.offset), "*b*");
	});

	it("returns the same nodes on a second lookup", () => {
		const document = parse("![a *b*](c)\n");
		const image = firstImage(document);
		assert.strictEqual(described(document, image), described(document, image));
	});

	it("is none for an image the parse did not produce", () => {
		const document = parse("![a *b*](c)\n");
		const image = firstImage(document) as Image;
		assert.isTrue(Option.isNone(document.imageDescription({ ...image } as Image)));
	});

	it("reads a description nesting past the hardening cap as none, where the parse still succeeds", () => {
		const document = parse(`![${"*".repeat(3_000)}a${"*".repeat(3_000)}](b)\n`);
		assert.isTrue(Option.isNone(document.imageDescription(firstImage(document))));
	});

	it("walks images nested 20,000 deep one level at a time", () => {
		const depth = 20_000;
		const document = parse(`${"![".repeat(depth)}a${"](b)".repeat(depth)}\n`);
		let image: MarkdownNode | undefined = firstImage(document);
		let levels = 0;
		while (image !== undefined) {
			levels++;
			image = described(document, image as Image).find((node) => node.type === "image");
		}
		assert.strictEqual(levels, depth);
	});
});
