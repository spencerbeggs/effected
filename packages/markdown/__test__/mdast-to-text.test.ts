// Mdast.toText: defined as mdast-util-to-string@4 applied to the node's
// Mdast.toMdast projection.
//
// Fixtures for this function MUST come from PARSED trees, not only hand-built
// nodes. The engine's nodes carry conventions a hand-built node never has —
// a parsed Code.value keeps its final line ending, which toMdast strips — and
// a table of hand-built nodes is exactly what once hid that divergence. Two
// layers therefore pin it:
//
// - a projection oracle over the whole conformance corpus: the upstream
//   algorithm (lib/index.js, reproduced verbatim below over plain JSON) run on
//   toMdast(root), compared against toText on every node of the parsed tree,
//   walked in parallel with its projection;
// - a fixture table: every node kind under both option flags, with rows built
//   by parsing (fenced and indented code, alone and nested) alongside the
//   hand-built ones for kinds the parser never produces (MDX, frontmatter).
//
// The real library is not a devDependency: commonmark is the package's one
// exact-pinned oracle, and adding a second for a ~20-line algorithm was
// declined in favour of the verbatim reproduction.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { Markdown } from "../src/Markdown.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import type { MarkdownNode } from "../src/MarkdownNode.js";
import {
	Blockquote,
	Break,
	Code,
	Definition,
	Delete,
	Emphasis,
	FootnoteDefinition,
	FootnoteReference,
	Frontmatter,
	Heading,
	Html,
	Image,
	ImageReference,
	InlineCode,
	Link,
	LinkReference,
	List,
	ListItem,
	MdxFlowExpression,
	MdxJsxFlowElement,
	MdxJsxTextElement,
	MdxTextExpression,
	MdxjsEsm,
	Paragraph,
	Root,
	Strong,
	Table,
	TableCell,
	TableRow,
	Text,
	ThematicBreak,
} from "../src/MarkdownNode.js";
import { Mdast } from "../src/Mdast.js";
import { loadGfmSpecExtensionExamples, loadSpecExamples } from "./e2e/support/corpus.js";

/** mdast-util-to-string@4.0.0 lib/index.js, verbatim in behaviour, over plain mdast JSON. */
const upstreamToString = (value: unknown, includeImageAlt = true, includeHtml = true): string => {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const node = value as Record<string, unknown>;
		if ("value" in node) return node.type === "html" && !includeHtml ? "" : (node.value as string);
		if (includeImageAlt && "alt" in node && node.alt) return node.alt as string;
		if ("children" in node) return upstreamToString(node.children, includeImageAlt, includeHtml);
	}
	if (Array.isArray(value)) return value.map((child) => upstreamToString(child, includeImageAlt, includeHtml)).join("");
	return "";
};

const parsed = (source: string): Root => Result.getOrThrow(Markdown.parseResult(source));

/** The first root child of a parsed source. */
const parsedBlock = (source: string): MarkdownNode => {
	const child = parsed(source).children[0];
	assert.isDefined(child);
	return child as MarkdownNode;
};

const t = (value: string) => Text.make({ value });
const html = Html.make({ value: "<b>" });
const image = Image.make({ url: "u", alt: "pic" });
const cell = TableCell.make({ children: [t("c"), html] });

/** [label, node, default, includeHtml false, includeImageAlt false]. */
const table: ReadonlyArray<readonly [string, MarkdownNode, string, string, string]> = [
	["text", t("a"), "a", "a", "a"],
	["inlineCode", InlineCode.make({ value: "x()" }), "x()", "x()", "x()"],
	["html", html, "<b>", "", "<b>"],
	["break", Break.make({}), "", "", ""],
	["image with alt", image, "pic", "pic", ""],
	["image with empty alt", Image.make({ url: "u", alt: "" }), "", "", ""],
	["image without alt", Image.make({ url: "u" }), "", "", ""],
	["imageReference", ImageReference.make({ identifier: "i", referenceType: "full", alt: "ref" }), "ref", "ref", ""],
	["emphasis", Emphasis.make({ children: [t("e"), html] }), "e<b>", "e", "e<b>"],
	["strong", Strong.make({ children: [t("s"), image] }), "spic", "spic", "s"],
	["delete", Delete.make({ children: [t("d")] }), "d", "d", "d"],
	["link", Link.make({ url: "u", children: [t("l"), image] }), "lpic", "lpic", "l"],
	[
		"linkReference",
		LinkReference.make({ identifier: "r", referenceType: "shortcut", children: [t("r")] }),
		"r",
		"r",
		"r",
	],
	["footnoteReference", FootnoteReference.make({ identifier: "1" }), "", "", ""],
	["mdxJsxTextElement", MdxJsxTextElement.make({ name: "b", attributes: [], children: [t("j")] }), "j", "j", "j"],
	["mdxTextExpression", MdxTextExpression.make({ value: "1+1" }), "1+1", "1+1", "1+1"],
	["thematicBreak", ThematicBreak.make({}), "", "", ""],
	["code", Code.make({ value: "let x" }), "let x", "let x", "let x"],
	["definition", Definition.make({ identifier: "d", url: "u" }), "", "", ""],
	[
		"footnoteDefinition",
		FootnoteDefinition.make({ identifier: "1", children: [Paragraph.make({ children: [t("f")] })] }),
		"f",
		"f",
		"f",
	],
	["paragraph", Paragraph.make({ children: [t("p "), html, Break.make({}), image] }), "p <b>pic", "p pic", "p <b>"],
	["heading", Heading.make({ depth: 1, children: [t("h"), html] }), "h<b>", "h", "h<b>"],
	["tableCell", cell, "c<b>", "c", "c<b>"],
	["tableRow", TableRow.make({ children: [cell, cell] }), "c<b>c<b>", "cc", "c<b>c<b>"],
	["table", Table.make({ align: [null], children: [TableRow.make({ children: [cell] })] }), "c<b>", "c", "c<b>"],
	[
		"list / listItem / blockquote",
		List.make({
			ordered: false,
			children: [
				ListItem.make({ children: [Blockquote.make({ children: [Paragraph.make({ children: [t("q")] })] })] }),
			],
		}),
		"q",
		"q",
		"q",
	],
	["flow html", html, "<b>", "", "<b>"],
	["mdxFlowExpression", MdxFlowExpression.make({ value: "x" }), "x", "x", "x"],
	[
		"mdxJsxFlowElement",
		MdxJsxFlowElement.make({ name: "N", attributes: [], children: [Paragraph.make({ children: [t("n")] })] }),
		"n",
		"n",
		"n",
	],
	[
		"mdxjsEsm",
		MdxjsEsm.make({ value: "export const a = 1" }),
		"export const a = 1",
		"export const a = 1",
		"export const a = 1",
	],
	["frontmatter", Frontmatter.make({ format: "yaml", value: "a: 1" }), "a: 1", "a: 1", "a: 1"],
	["parsed fenced code", parsedBlock("```js\nlet x\n```\n"), "let x", "let x", "let x"],
	["parsed fenced code, two lines", parsedBlock("```\na\nb\n```\n"), "a\nb", "a\nb", "a\nb"],
	["parsed indented code", parsedBlock("    let x\n"), "let x", "let x", "let x"],
	["parsed fenced code in a list item", parsedBlock("- ```\n  a\n  ```\n"), "a", "a", "a"],
	["parsed indented code in a list item", parsedBlock("- item\n\n      code\n"), "itemcode", "itemcode", "itemcode"],
	["parsed fenced code in a blockquote", parsedBlock("> ```\n> q\n> ```\n"), "q", "q", "q"],
	["parsed indented code in a blockquote", parsedBlock(">     ind\n"), "ind", "ind", "ind"],
	["parsed root with code", parsed("para\n\n```\nc\n```\n"), "parac", "parac", "parac"],
	[
		"root (blocks concatenate with no separator)",
		Root.make({ children: [Paragraph.make({ children: [t("one")] }), Paragraph.make({ children: [t("two")] })] }),
		"onetwo",
		"onetwo",
		"onetwo",
	],
];

/** Walk a node and its projection in parallel, asserting toText agrees with upstream on the projection at every node. */
const assertAgrees = (node: MarkdownNode, projected: unknown, label: string): number => {
	let count = 0;
	for (const [includeImageAlt, includeHtml] of [
		[true, true],
		[false, true],
		[true, false],
	] as const) {
		assert.strictEqual(
			Mdast.toText(node, { includeImageAlt, includeHtml }),
			upstreamToString(projected, includeImageAlt, includeHtml),
			`${label} ${node.type} alt=${includeImageAlt} html=${includeHtml}`,
		);
	}
	count += 1;
	if ("children" in node) {
		const children = node.children as ReadonlyArray<MarkdownNode>;
		const projectedChildren = (projected as { children: ReadonlyArray<unknown> }).children;
		assert.strictEqual(projectedChildren.length, children.length, label);
		children.forEach((child, index) => {
			count += assertAgrees(child, projectedChildren[index], label);
		});
	}
	return count;
};

describe("Mdast.toText projection oracle", () => {
	it("agrees with upstream mdast-util-to-string on toMdast(root) at every node of the corpus", () => {
		let nodes = 0;
		let codeNodes = 0;
		for (const example of [...loadSpecExamples(), ...loadGfmSpecExtensionExamples()]) {
			const root = parsed(example.markdown);
			nodes += assertAgrees(root, Mdast.toMdast(root), `example ${example.example}`);
			codeNodes += JSON.stringify(Mdast.toMdast(root)).split('"type":"code"').length - 1;
		}
		assert.isAbove(nodes, 3000);
		assert.isAbove(codeNodes, 80);
	});
});

describe("Mdast.toText", () => {
	for (const [label, node, byDefault, withoutHtml, withoutAlt] of table) {
		it(label, () => {
			assert.strictEqual(Mdast.toText(node), byDefault, "defaults");
			assert.strictEqual(Mdast.toText(node, { includeHtml: true, includeImageAlt: true }), byDefault, "explicit true");
			assert.strictEqual(Mdast.toText(node, { includeHtml: false }), withoutHtml, "includeHtml: false");
			assert.strictEqual(Mdast.toText(node, { includeImageAlt: false }), withoutAlt, "includeImageAlt: false");
		});
	}

	it("differs from the display derivation behind DocumentHeading.text", () => {
		const document = Result.getOrThrow(MarkdownDocument.parseResult("# a <i>b</i> ![c](u)\n"));
		const heading = document.headings[0];
		assert.isDefined(heading);
		if (heading === undefined) return;
		assert.strictEqual(Mdast.toText(heading.node), "a <i>b</i> c");
		assert.notStrictEqual(heading.text, Mdast.toText(heading.node));
	});
});
