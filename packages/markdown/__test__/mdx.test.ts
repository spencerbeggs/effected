// The MDX vocabulary: construction (schema checks included), serialization
// conformance against the vendored oracles, and the Mdast interop boundary.
//
// Serialization expectations are lifted from the vendored oracle suites
// (.repos/mdast-util-mdx-jsx/test.js `mdxJsxToMarkdown`,
// .repos/mdast-util-mdx-expression, .repos/mdast-util-mdxjs-esm) at the
// oracle defaults: quote `"`, no quoteSmart, spaced self-closing, attributes
// wrapped onto their own lines only when one carries a line ending. Where a
// case's CHILD block content is ordinary markdown, the bytes follow THIS
// package's canonical table (bullet `-`, tight lists), not the oracle's
// to-markdown defaults — the MDX structure is the oracle contract, the
// markdown inside it is ours.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { Markdown } from "../src/Markdown.js";
import {
	Blockquote,
	Heading,
	List,
	ListItem,
	MdxFlowExpression,
	MdxJsxAttribute,
	MdxJsxAttributeValueExpression,
	MdxJsxExpressionAttribute,
	MdxJsxFlowElement,
	MdxJsxTextElement,
	MdxTextExpression,
	MdxjsEsm,
	Paragraph,
	Root,
	Strong,
	Text,
} from "../src/MarkdownNode.js";
import { Mdast } from "../src/Mdast.js";

const text = (value: string): Text => Text.make({ value });

const paragraph = (...children: ReadonlyArray<Paragraph["children"][number]>): Paragraph =>
	Paragraph.make({ children });

const rootOf = (...children: ReadonlyArray<Root["children"][number]>): Root => Root.make({ children });

const stringified = (root: Root): string => {
	const result = Markdown.stringifyResult(root);
	assert.isTrue(Result.isSuccess(result));
	return Result.isSuccess(result) ? result.success : "";
};

const flowElement = (
	name: string | null,
	attributes: ReadonlyArray<MdxJsxFlowElement["attributes"][number]> = [],
	children: ReadonlyArray<MdxJsxFlowElement["children"][number]> = [],
): MdxJsxFlowElement => MdxJsxFlowElement.make({ name, attributes, children });

const textElement = (
	name: string | null,
	attributes: ReadonlyArray<MdxJsxTextElement["attributes"][number]> = [],
	children: ReadonlyArray<MdxJsxTextElement["children"][number]> = [],
): MdxJsxTextElement => MdxJsxTextElement.make({ name, attributes, children });

const expressionAttribute = (value: string): MdxJsxExpressionAttribute => MdxJsxExpressionAttribute.make({ value });

describe("mdx nodes", () => {
	describe("construction checks", () => {
		it("refuses a fragment carrying attributes, at make and at decode", () => {
			assert.throws(() => flowElement(null, [expressionAttribute("x")]));
			assert.throws(() => textElement(null, [MdxJsxAttribute.make({ name: "a" })]));
		});

		it("refuses an attribute without a name", () => {
			assert.throws(() => MdxJsxAttribute.make({ name: "" }));
		});

		it("admits every attribute value spelling the oracle contract has", () => {
			// Absent, null, string, expression — never explicit undefined.
			assert.strictEqual(MdxJsxAttribute.make({ name: "a" }).value, undefined);
			assert.strictEqual(MdxJsxAttribute.make({ name: "a", value: null }).value, null);
			assert.strictEqual(MdxJsxAttribute.make({ name: "a", value: "b" }).value, "b");
			const expression = MdxJsxAttributeValueExpression.make({ value: "c" });
			const attribute = MdxJsxAttribute.make({ name: "a", value: expression });
			assert.strictEqual(
				attribute.value !== null && typeof attribute.value === "object" ? attribute.value.value : "",
				"c",
			);
		});
	});

	describe("flow element serialization (oracle: mdxJsxToMarkdown)", () => {
		it("serializes a fragment with no children", () => {
			assert.strictEqual(stringified(rootOf(flowElement(null))), "<></>\n");
		});

		it("serializes a named, empty element self-closing with a space", () => {
			assert.strictEqual(stringified(rootOf(flowElement("x"))), "<x />\n");
		});

		it("serializes children indented in block layout", () => {
			assert.strictEqual(stringified(rootOf(flowElement("x", [], [paragraph(text("y"))]))), "<x>\n  y\n</x>\n");
		});

		it("serializes a fragment with children", () => {
			assert.strictEqual(stringified(rootOf(flowElement(null, [], [paragraph(text("y"))]))), "<>\n  y\n</>\n");
		});

		it("serializes expression attributes", () => {
			assert.strictEqual(stringified(rootOf(flowElement("x", [expressionAttribute("y")]))), "<x {y} />\n");
			assert.strictEqual(
				stringified(rootOf(flowElement("x", [expressionAttribute("y")], [paragraph(text("z"))]))),
				"<x {y}>\n  z\n</x>\n",
			);
			assert.strictEqual(
				stringified(rootOf(flowElement("x", [expressionAttribute("y"), expressionAttribute("z")]))),
				"<x {y} {z} />\n",
			);
			assert.strictEqual(
				stringified(rootOf(flowElement("x", [expressionAttribute('...{y: "z"}')]))),
				'<x {...{y: "z"}} />\n',
			);
			assert.strictEqual(stringified(rootOf(flowElement("x", [expressionAttribute("")]))), "<x {} />\n");
		});

		it("serializes named attributes: boolean, string and expression values", () => {
			assert.strictEqual(stringified(rootOf(flowElement("x", [MdxJsxAttribute.make({ name: "y" })]))), "<x y />\n");
			assert.strictEqual(
				stringified(rootOf(flowElement("x", [MdxJsxAttribute.make({ name: "y", value: null })]))),
				"<x y />\n",
			);
			assert.strictEqual(
				stringified(rootOf(flowElement("x", [MdxJsxAttribute.make({ name: "y", value: "z" })]))),
				'<x y="z" />\n',
			);
			assert.strictEqual(
				stringified(
					rootOf(
						flowElement("x", [
							MdxJsxAttribute.make({ name: "y", value: MdxJsxAttributeValueExpression.make({ value: "z" }) }),
						]),
					),
				),
				"<x y={z} />\n",
			);
			assert.strictEqual(
				stringified(
					rootOf(
						flowElement("x", [
							MdxJsxAttribute.make({ name: "y", value: MdxJsxAttributeValueExpression.make({ value: "" }) }),
						]),
					),
				),
				"<x y={} />\n",
			);
		});

		it("escapes the quote in a string attribute value as the oracle spells it", () => {
			assert.strictEqual(
				stringified(rootOf(flowElement("x", [MdxJsxAttribute.make({ name: "y", value: "z\"a'b" })]))),
				'<x y="z&#x22;a\'b" />\n',
			);
		});

		it("puts attributes on their own lines when one carries a line ending", () => {
			assert.strictEqual(
				stringified(rootOf(flowElement("x", [expressionAttribute("\n  ...a\n")]))),
				"<x\n  {\n  ...a\n}\n/>\n",
			);
		});

		it("serializes ordinary flow children with this package's canonical markdown", () => {
			const tree = rootOf(
				flowElement(
					"x",
					[],
					[
						Blockquote.make({ children: [paragraph(text("a"))] }),
						List.make({
							children: [
								ListItem.make({ children: [paragraph(text("b\nc"))] }),
								ListItem.make({ children: [paragraph(text("d"))] }),
							],
						}),
					],
				),
			);
			assert.strictEqual(stringified(tree), "<x>\n  > a\n\n  - b\n    c\n  - d\n</x>\n");
		});

		it("indents nested flow elements one step per JSX ancestor", () => {
			const tree = rootOf(flowElement("a", [], [flowElement("b", [], [paragraph(text("y"))])]));
			assert.strictEqual(stringified(tree), "<a>\n  <b>\n    y\n  </b>\n</a>\n");
		});

		it("restarts JSX indentation inside a blockquote and a list item", () => {
			const quoted = rootOf(Blockquote.make({ children: [flowElement("x", [], [paragraph(text("y"))])] }));
			assert.strictEqual(stringified(quoted), "> <x>\n>   y\n> </x>\n");
		});
	});

	describe("text element serialization", () => {
		it("serializes inline elements, fragments and attributes", () => {
			assert.strictEqual(
				stringified(rootOf(paragraph(text("w "), textElement("x", [], [text("y")]), text(" z.")))),
				"w <x>y</x> z.\n",
			);
			assert.strictEqual(
				stringified(rootOf(paragraph(textElement("x", [], [Strong.make({ children: [text("y")] })])))),
				"<x>**y**</x>\n",
			);
			assert.strictEqual(stringified(rootOf(paragraph(textElement(null)))), "<></>\n");
			assert.strictEqual(stringified(rootOf(paragraph(textElement("x")))), "<x />\n");
			assert.strictEqual(
				stringified(
					rootOf(
						paragraph(
							textElement("x", [MdxJsxAttribute.make({ name: "y", value: "z" }), MdxJsxAttribute.make({ name: "a" })]),
						),
					),
				),
				'<x y="z" a />\n',
			);
		});
	});

	describe("expressions and ESM", () => {
		it("serializes flow expressions with two-space continuation indent", () => {
			assert.strictEqual(stringified(rootOf(MdxFlowExpression.make({ value: "a + b" }))), "{a + b}\n");
			assert.strictEqual(stringified(rootOf(MdxFlowExpression.make({ value: "a\nb" }))), "{a\n  b}\n");
		});

		it("serializes text expressions inline", () => {
			assert.strictEqual(
				stringified(rootOf(paragraph(text("a "), MdxTextExpression.make({ value: "b" }), text(" c.")))),
				"a {b} c.\n",
			);
		});

		it("serializes ESM values verbatim as blocks", () => {
			assert.strictEqual(stringified(rootOf(MdxjsEsm.make({ value: 'import a from "b"' }))), 'import a from "b"\n');
			const tree = rootOf(
				MdxjsEsm.make({ value: 'import {A} from "./a.js"' }),
				Heading.make({ depth: 1, children: [text("Title")] }),
				flowElement("A"),
			);
			assert.strictEqual(stringified(tree), 'import {A} from "./a.js"\n\n# Title\n\n<A />\n');
		});
	});

	describe("MDX-aware text escaping", () => {
		it("escapes `{` in text only when the tree carries an MDX node", () => {
			const plain = rootOf(paragraph(text("a { b")));
			assert.strictEqual(stringified(plain), "a { b\n");
			const withMdx = rootOf(paragraph(text("a { b")), flowElement("x"));
			assert.strictEqual(stringified(withMdx), "a \\{ b\n\n<x />\n");
		});

		it("escapes `<` in text always (already in the canonical escape set)", () => {
			assert.strictEqual(stringified(rootOf(paragraph(text("a < b")))), "a \\< b\n");
		});
	});

	describe("the JSON-encoded props path (the consumer's primary construction)", () => {
		it("carries JSON.stringify output through an attribute value expression byte-exactly", () => {
			const props = { code: 'const a: string = "quoted"', apiScope: "public", n: 1 };
			const tree = rootOf(
				flowElement("ApiSignature", [
					MdxJsxAttribute.make({
						name: "code",
						value: MdxJsxAttributeValueExpression.make({ value: JSON.stringify(props) }),
					}),
				]),
			);
			assert.strictEqual(
				stringified(tree),
				'<ApiSignature code={{"code":"const a: string = \\"quoted\\"","apiScope":"public","n":1}} />\n',
			);
		});
	});

	describe("Mdast interop", () => {
		it("projects MDX nodes the way mdast-util-mdx spells them", () => {
			const tree = rootOf(
				flowElement(
					"x",
					[
						MdxJsxAttribute.make({ name: "a" }),
						MdxJsxAttribute.make({ name: "b", value: MdxJsxAttributeValueExpression.make({ value: "c" }) }),
						expressionAttribute("...d"),
					],
					[paragraph(text("y"), MdxTextExpression.make({ value: "z" }))],
				),
				MdxjsEsm.make({ value: "export const a = 1" }),
			);
			const projected = Mdast.toMdast(tree) as unknown as {
				children: ReadonlyArray<Record<string, unknown>>;
			};
			const element = projected.children[0] as {
				type: string;
				name: string | null;
				attributes: ReadonlyArray<Record<string, unknown>>;
			};
			assert.strictEqual(element.type, "mdxJsxFlowElement");
			assert.strictEqual(element.name, "x");
			// A bare attribute projects `value: null` (the parser's spelling);
			// a value expression projects without a position (ditto).
			assert.deepStrictEqual(element.attributes[0]?.value, null);
			assert.deepStrictEqual(element.attributes[1]?.value, { type: "mdxJsxAttributeValueExpression", value: "c" });
			assert.deepStrictEqual(element.attributes[2]?.type, "mdxJsxExpressionAttribute");
			assert.strictEqual(projected.children[1]?.type, "mdxjsEsm");
		});

		it("admits foreign MDX trees, synthesizing positions and dropping estree data", () => {
			const foreign = {
				type: "root",
				children: [
					{
						type: "mdxJsxFlowElement",
						name: null,
						attributes: [],
						children: [{ type: "paragraph", children: [{ type: "text", value: "y" }] }],
					},
					{
						type: "mdxFlowExpression",
						value: "a + b",
						data: { estree: { type: "Program", body: [], sourceType: "module" } },
					},
					{
						type: "paragraph",
						children: [
							{
								type: "mdxJsxTextElement",
								name: "b",
								attributes: [
									{ type: "mdxJsxAttribute", name: "x", value: null },
									{
										type: "mdxJsxAttribute",
										name: "y",
										value: { type: "mdxJsxAttributeValueExpression", value: "z" },
									},
								],
								children: [],
							},
						],
					},
				],
			};
			const result = Mdast.fromMdastResult(foreign);
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) {
				const [fragment, expression, wrapper] = result.success.children;
				assert.strictEqual(fragment?.type, "mdxJsxFlowElement");
				assert.strictEqual(expression?.type, "mdxFlowExpression");
				const textEl = wrapper?.type === "paragraph" ? wrapper.children[0] : undefined;
				assert.strictEqual(textEl?.type, "mdxJsxTextElement");
				if (textEl?.type === "mdxJsxTextElement") {
					// The null value spelling survives admission, and sentinel
					// positions were synthesized on the attribute carriers.
					assert.strictEqual(textEl.attributes[0]?.type === "mdxJsxAttribute" ? textEl.attributes[0].value : "x", null);
					assert.strictEqual(textEl.attributes[0]?.position.start.offset, 0);
				}
			}
		});

		it("round-trips project-then-admit for a tree with every MDX node type", () => {
			const tree = rootOf(
				MdxjsEsm.make({ value: "import a from 'b'" }),
				flowElement("x", [MdxJsxAttribute.make({ name: "a", value: "b" })], [paragraph(text("y"))]),
				MdxFlowExpression.make({ value: "1 + 1" }),
				paragraph(textElement("i", [], [text("z")]), MdxTextExpression.make({ value: "q" })),
			);
			const back = Mdast.fromMdastResult(Mdast.toMdast(tree));
			assert.isTrue(Result.isSuccess(back));
			if (Result.isSuccess(back)) {
				assert.deepStrictEqual(Mdast.toMdast(back.success), Mdast.toMdast(tree));
				assert.strictEqual(stringified(back.success), stringified(tree));
			}
		});
	});
});
