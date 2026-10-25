// MarkdownTransform: the typed post-order map with structural sharing,
// heading shifting built on it, and the index-based root-level section finder
// that shares its boundary rule with MarkdownDocument.sections.
//
// The walk order is a published contract (stateful handlers depend on it), so
// it is pinned with a recording handler; the clamp is pinned exhaustively over
// every depth x offset x bound combination. Both are the edges the
// mutate-the-edges pass flipped (pre-order walk, clamp removed) to prove the
// suite goes red.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { Markdown } from "../src/Markdown.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import type { FlowContent, HeadingDepth, MarkdownNode, PhrasingContent } from "../src/MarkdownNode.js";
import {
	Blockquote,
	Delete,
	Emphasis,
	FootnoteDefinition,
	Heading,
	Html,
	Link,
	LinkReference,
	List,
	ListItem,
	MdxJsxFlowElement,
	MdxJsxTextElement,
	Paragraph,
	Root,
	Strong,
	Table,
	TableCell,
	TableRow,
	Text,
	ThematicBreak,
} from "../src/MarkdownNode.js";
import type { MarkdownPhrasingOnlyType } from "../src/MarkdownTransform.js";
import { MarkdownTransform } from "../src/MarkdownTransform.js";
import { Mdast } from "../src/Mdast.js";
import type { SpecExample } from "./e2e/support/corpus.js";
import { loadGfmSpecExtensionExamples, loadSpecExamples } from "./e2e/support/corpus.js";

const parse = (text: string): Root => {
	const result = Markdown.parseResult(text);
	assert.isTrue(Result.isSuccess(result));
	return Result.getOrThrow(result);
};

const stringify = (node: Parameters<typeof Markdown.stringifyResult>[0]): string =>
	Result.getOrThrow(Markdown.stringifyResult(node));

/** The parent `type` of every node of `type`, in pre-order. */
const parentsOf = (node: MarkdownNode, type: string): Array<string> => {
	const out: Array<string> = [];
	if ("children" in node) {
		for (const child of node.children as ReadonlyArray<MarkdownNode>) {
			if (child.type === type) out.push(node.type);
			out.push(...parentsOf(child, type));
		}
	}
	return out;
};

const toReference = (link: Link): PhrasingContent =>
	LinkReference.make({ identifier: link.url, label: link.url, referenceType: "full", children: link.children });

const corpus: ReadonlyArray<SpecExample> = [...loadSpecExamples(), ...loadGfmSpecExtensionExamples()];

const fromMdast = (root: Root): Root => {
	const decoded = Mdast.fromMdastResult(Mdast.toMdast(root));
	assert.isTrue(Result.isSuccess(decoded));
	return Result.getOrThrow(decoded);
};

describe("MarkdownTransform.map", () => {
	it("returns the input instance when no handler is given, over the whole corpus", () => {
		for (const example of corpus) {
			const root = parse(example.markdown);
			assert.strictEqual(MarkdownTransform.map(root, {}), root, `example ${example.example}`);
		}
	});

	it("returns the input instance when handlers return their node unchanged", () => {
		const root = parse("# A *b*\n\n- [x](u)\n\n| a |\n| - |\n| b |\n");
		const same = MarkdownTransform.map(root, { text: (n) => n, link: (n) => n, heading: (n) => n });
		assert.strictEqual(same, root);
	});

	it("keeps untouched siblings by identity and rebuilds only the changed spine", () => {
		const root = parse("# Title\n\nSee [docs](u).\n\nOther *text*.\n");
		const mapped = MarkdownTransform.map(root, { link: toReference });
		assert.notStrictEqual(mapped, root);
		assert.strictEqual(mapped.children[0], root.children[0]);
		assert.notStrictEqual(mapped.children[1], root.children[1]);
		assert.strictEqual(mapped.children[2], root.children[2]);
		const before = root.children[1] as Paragraph;
		const after = mapped.children[1] as Paragraph;
		assert.strictEqual(after.children[0], before.children[0]);
		assert.strictEqual(after.children[2], before.children[2]);
		assert.strictEqual(after.children[1]?.type, "linkReference");
	});

	it("keeps every other field of a rebuilt parent, including position, and keeps absent optional keys absent", () => {
		const root = parse("- [a](u)\n");
		const mapped = MarkdownTransform.map(root, { link: toReference });
		const item = (root.children[0] as { children: ReadonlyArray<ListItem> }).children[0] as ListItem;
		const rebuilt = (mapped.children[0] as { children: ReadonlyArray<ListItem> }).children[0] as ListItem;
		assert.notStrictEqual(rebuilt, item);
		assert.instanceOf(rebuilt, ListItem);
		assert.isFalse("checked" in rebuilt);
		assert.strictEqual(rebuilt.spread, item.spread);
		assert.deepStrictEqual(rebuilt.position, item.position);
		assert.deepStrictEqual(mapped.position, root.position);
		assert.instanceOf(mapped, Root);
	});

	it("hands a handler its node with already-transformed children", () => {
		const root = parse("Hello *world*\n");
		const seen: Array<string> = [];
		MarkdownTransform.map(root, {
			text: (node) => Text.make({ value: node.value.toUpperCase(), position: node.position }),
			paragraph: (node) => {
				seen.push(stringify(Root.make({ children: [node] })));
				return node;
			},
		});
		assert.deepStrictEqual(seen, ["HELLO *WORLD*\n"]);
	});

	it("walks post-order, children left to right, the input node last", () => {
		const root = parse("# A *b*\n\nc [d](u)\n");
		const order: Array<string> = [];
		const record = <N extends { readonly type: string }>(node: N): N => {
			order.push("value" in node ? `${node.type}:${String(node.value)}` : node.type);
			return node;
		};
		MarkdownTransform.map(root, {
			root: record,
			heading: record,
			paragraph: record,
			emphasis: record,
			link: record,
			text: record,
		});
		assert.deepStrictEqual(order, [
			"text:A ",
			"text:b",
			"emphasis",
			"heading",
			"text:c ",
			"text:d",
			"link",
			"paragraph",
			"root",
		]);
	});

	it("supports a stateful handler relying on document order (dedupe keeping the first)", () => {
		const root = parse("[a](one) [b](two) [c](one)\n");
		const seen = new Set<string>();
		const mapped = MarkdownTransform.map(root, {
			link: (link) => {
				if (seen.has(link.url)) return Text.make({ value: "dup" });
				seen.add(link.url);
				return link;
			},
		});
		assert.strictEqual(stringify(mapped), "[a](one) [b](two) dup\n");
	});

	const everywhere = "# [h](u)\n\n[p](u)\n\n*[e](u)*\n\n| [t](u) |\n| - |\n| x |\n";

	for (const [label, build] of [
		["Markdown.parse", (source: string) => parse(source)],
		["Mdast.fromMdast", (source: string) => fromMdast(parse(source))],
	] as const) {
		it(`changes link to linkReference inside paragraph, heading, table cell and emphasis (${label})`, () => {
			const root = build(everywhere);
			assert.deepStrictEqual(parentsOf(root, "link").sort(), ["emphasis", "heading", "paragraph", "tableCell"]);
			const mapped = MarkdownTransform.map(root, { link: toReference });
			assert.deepStrictEqual(parentsOf(mapped, "link"), []);
			assert.deepStrictEqual(parentsOf(mapped, "linkReference").sort(), [
				"emphasis",
				"heading",
				"paragraph",
				"tableCell",
			]);
			assert.strictEqual(stringify(mapped), "# [h][u]\n\n[p][u]\n\n*[e][u]*\n\n| [t][u] |\n| --- |\n| x |\n");
		});
	}

	it("reaches every Text node through every container kind", () => {
		// Every node class with a `children` array in MarkdownNode.ts — 17 of
		// them — appears at least once, each holding a Text leaf (directly or via
		// its required child kind). The corpus has no footnoteDefinition and no
		// MDX, which is why this tree is constructed.
		const leaf = (label: string) => Text.make({ value: label });
		const phrasing = [
			leaf("p"),
			Emphasis.make({ children: [leaf("em")] }),
			Strong.make({ children: [leaf("strong")] }),
			Delete.make({ children: [leaf("del")] }),
			Link.make({ url: "u", children: [leaf("link")] }),
			LinkReference.make({ identifier: "r", referenceType: "shortcut", children: [leaf("linkref")] }),
			MdxJsxTextElement.make({ name: "b", attributes: [], children: [leaf("jsxtext")] }),
		];
		const root = Root.make({
			children: [
				Heading.make({ depth: 1, children: [leaf("heading")] }),
				Paragraph.make({ children: phrasing }),
				Blockquote.make({ children: [Paragraph.make({ children: [leaf("quote")] })] }),
				List.make({
					ordered: false,
					children: [ListItem.make({ children: [Paragraph.make({ children: [leaf("item")] })] })],
				}),
				Table.make({
					align: [null],
					children: [TableRow.make({ children: [TableCell.make({ children: [leaf("cell")] })] })],
				}),
				FootnoteDefinition.make({
					identifier: "1",
					children: [Paragraph.make({ children: [leaf("footnote")] })],
				}),
				MdxJsxFlowElement.make({
					name: "Note",
					attributes: [],
					children: [Paragraph.make({ children: [leaf("jsxflow")] })],
				}),
			],
		});
		const containers = new Set<string>();
		const texts: Array<string> = [];
		const collect = (node: MarkdownNode): void => {
			if (node.type === "text") texts.push(node.value);
			if ("children" in node) {
				containers.add(node.type);
				for (const child of node.children as ReadonlyArray<MarkdownNode>) collect(child);
			}
		};
		collect(root);
		assert.deepStrictEqual([...containers].sort(), [
			"blockquote",
			"delete",
			"emphasis",
			"footnoteDefinition",
			"heading",
			"link",
			"linkReference",
			"list",
			"listItem",
			"mdxJsxFlowElement",
			"mdxJsxTextElement",
			"paragraph",
			"root",
			"strong",
			"table",
			"tableCell",
			"tableRow",
		]);
		let calls = 0;
		const mapped = MarkdownTransform.map(root, {
			text: (node) => {
				calls += 1;
				return Text.make({ value: node.value.toUpperCase() });
			},
		});
		assert.strictEqual(calls, texts.length);
		const after: Array<string> = [];
		const collectAfter = (node: MarkdownNode): void => {
			if (node.type === "text") after.push(node.value);
			if ("children" in node) for (const child of node.children as ReadonlyArray<MarkdownNode>) collectAfter(child);
		};
		collectAfter(mapped);
		assert.deepStrictEqual(
			after,
			texts.map((value) => value.toUpperCase()),
		);
	});

	it("reaches the children of MDX JSX flow and text elements", () => {
		const root = Root.make({
			children: [
				MdxJsxFlowElement.make({
					name: "Note",
					attributes: [],
					children: [
						Paragraph.make({
							children: [
								MdxJsxTextElement.make({ name: "b", attributes: [], children: [Text.make({ value: "inner" })] }),
							],
						}),
					],
				}),
			],
		});
		const mapped = MarkdownTransform.map(root, { text: (node) => Text.make({ value: node.value.toUpperCase() }) });
		assert.include(stringify(mapped), "<b>INNER</b>");
		assert.notStrictEqual(mapped.children[0], root.children[0]);
		assert.instanceOf(mapped.children[0], MdxJsxFlowElement);
	});

	it("produces the output the class TSDoc example states", () => {
		const shifted = MarkdownTransform.shiftHeadings(parse("# Title\n\nSee [docs](https://example.com).\n"), 1);
		const rewritten = MarkdownTransform.map(shifted, {
			link: (link) => LinkReference.make({ identifier: "docs", referenceType: "full", children: link.children }),
		});
		assert.strictEqual(stringify(rewritten), "## Title\n\nSee [docs][docs].\n");
	});

	it("maps a lone phrasing node to any phrasing content", () => {
		const link = Link.make({ url: "u", children: [Text.make({ value: "x" })] });
		const mapped: PhrasingContent = MarkdownTransform.map(link, { link: toReference });
		assert.strictEqual(mapped.type, "linkReference");
	});

	it("propagates a handler's exception", () => {
		assert.throws(
			() =>
				MarkdownTransform.map(parse("text\n"), {
					text: () => {
						throw new Error("boom");
					},
				}),
			"boom",
		);
	});

	it("returns the type parameter itself to a generic caller over non-phrasing nodes", () => {
		// The first overload: a caller generic over Root | FlowContent (or any
		// non-phrasing-only node) gets N back, not a deferred conditional.
		const upper = <N extends Root | FlowContent>(node: N): N =>
			MarkdownTransform.map(node, { text: (text) => Text.make({ value: text.value.toUpperCase() }) });
		const item = <N extends ListItem | TableRow | TableCell>(node: N): N => MarkdownTransform.map(node, {});
		const root = parse("a\n");
		const mappedRoot: Root = upper(root);
		assert.strictEqual(stringify(mappedRoot), "A\n");
		const paragraph: Paragraph = upper(Paragraph.make({ children: [Text.make({ value: "b" })] }));
		assert.instanceOf(paragraph, Paragraph);
		const row = TableRow.make({ children: [] });
		assert.strictEqual(item(row), row);
		const html = Html.make({ value: "<i>" });
		const sameHtml: Html = MarkdownTransform.map(html, {});
		assert.strictEqual(sameHtml, html);
	});

	it("widens a lone phrasing-only node's result to PhrasingContent", () => {
		const link = Link.make({ url: "u", children: [Text.make({ value: "x" })] });
		const widened = MarkdownTransform.map(link, { link: toReference });
		// @ts-expect-error -- the result is PhrasingContent, not Link: the handler may change its type
		const narrow: Link = widened;
		const wide: PhrasingContent = widened;
		assert.strictEqual(wide.type, "linkReference");
		assert.strictEqual(narrow, widened);
	});

	it("types handlers so only phrasing-only types may change type", () => {
		const root = parse("x\n");
		// @ts-expect-error -- a heading handler must return a Heading
		MarkdownTransform.map(root, { heading: () => Paragraph.make({ children: [] }) });
		// @ts-expect-error -- html is also flow content, so its handler must return Html
		MarkdownTransform.map(root, { html: () => Text.make({ value: "x" }) });
		// @ts-expect-error -- an html handler returning a Link would put a Link in a flow child list
		MarkdownTransform.map(root, { html: () => Link.make({ url: "u", children: [] }) });
		const html = Html.make({ value: "<b>" });
		const mappedHtml: Html = MarkdownTransform.map(html, { html: (node) => node });
		assert.strictEqual(mappedHtml, html);
		const root2: Root = MarkdownTransform.map(root, { emphasis: (node) => Text.make({ value: node.type }) });
		assert.instanceOf(root2, Root);
	});
});

// The overlap the handler typing rests on: `html` is the ONLY node class in
// both the phrasing and the flow unions. If a future member joins both, this
// fails to compile and the type-changing set must be re-examined.
type PhrasingFlowOverlap = Extract<PhrasingContent, FlowContent>;
const overlapIsExactlyHtml: [PhrasingFlowOverlap] extends [Html]
	? [Html] extends [PhrasingFlowOverlap]
		? true
		: false
	: false = true;

describe("MarkdownTransform handler typing", () => {
	it("rests on html being the only phrasing/flow overlap", () => {
		assert.isTrue(overlapIsExactlyHtml);
		const phrasingOnly: ReadonlyArray<MarkdownPhrasingOnlyType> = [
			"break",
			"delete",
			"emphasis",
			"footnoteReference",
			"image",
			"imageReference",
			"inlineCode",
			"link",
			"linkReference",
			"mdxJsxTextElement",
			"mdxTextExpression",
			"strong",
			"text",
		];
		// @ts-expect-error -- html is not phrasing-only
		const notPhrasingOnly: MarkdownPhrasingOnlyType = "html";
		assert.strictEqual(phrasingOnly.length, 13);
		assert.strictEqual(notPhrasingOnly, "html");
	});
});

describe("MarkdownTransform.shiftHeadings", () => {
	const depths = [1, 2, 3, 4, 5, 6] as const;
	const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

	it("clamps depth + by into [min, max] for every depth, offset in [-10, 10] and bound pair", () => {
		for (const depth of depths) {
			for (const style of depth <= 2 ? (["setext", "atx", undefined] as const) : (["atx", undefined] as const)) {
				const heading = Heading.make({
					depth,
					children: [Text.make({ value: "h" })],
					...(style === undefined ? {} : { headingStyle: style }),
				});
				for (let by = -10; by <= 10; by += 1) {
					for (const min of depths) {
						for (const max of depths) {
							if (min > max) continue;
							const shifted = MarkdownTransform.shiftHeadings(heading, by, { min, max });
							const expected = clamp(depth + by, min, max);
							const label = `d=${depth} by=${by} min=${min} max=${max} style=${style}`;
							assert.strictEqual(shifted.depth, expected, label);
							if (style === "setext") {
								assert.strictEqual("headingStyle" in shifted, expected <= 2, label);
							} else {
								assert.strictEqual(shifted.headingStyle, style, label);
							}
							if (expected === depth) assert.strictEqual(shifted, heading, label);
						}
					}
				}
			}
		}
	});

	it("defaults the bounds to 1 and 6", () => {
		for (const depth of depths) {
			const heading = Heading.make({ depth, children: [] });
			assert.strictEqual(MarkdownTransform.shiftHeadings(heading, 3).depth, clamp(depth + 3, 1, 6));
			assert.strictEqual(MarkdownTransform.shiftHeadings(heading, -3).depth, clamp(depth - 3, 1, 6));
		}
	});

	it("{ min: 4 } with by = 1 lands every depth at clamp(d + 1, 4, 6)", () => {
		const root = parse("# 1\n\n## 2\n\n### 3\n\n#### 4\n\n##### 5\n\n###### 6\n");
		const shifted = MarkdownTransform.shiftHeadings(root, 1, { min: 4 });
		assert.deepStrictEqual(
			shifted.children.map((child) => (child as Heading).depth),
			[4, 4, 4, 5, 6, 6],
		);
	});

	it("round-trips through stringify and parse with the expected depths", () => {
		const root = parse("# A\n\n## B\n\nSetext\n======\n\nTwo\n---\n");
		const output = stringify(MarkdownTransform.shiftHeadings(root, 1));
		assert.strictEqual(output, "## A\n\n### B\n\nSetext\n------\n\n### Two\n");
		const reparsed = parse(output);
		assert.deepStrictEqual(
			reparsed.children.map((child) => (child as Heading).depth),
			[2, 3, 2, 3],
		);
	});

	it("keeps identity when nothing changes", () => {
		const root = parse("# A\n\ntext\n");
		assert.strictEqual(MarkdownTransform.shiftHeadings(root, 0), root);
		assert.strictEqual(MarkdownTransform.shiftHeadings(root, -1), root);
		const plain = parse("plain\n");
		assert.strictEqual(MarkdownTransform.shiftHeadings(plain, 2), plain);
	});

	it("throws RangeError on a non-integer offset or invalid bounds", () => {
		const heading = Heading.make({ depth: 2, children: [] });
		assert.throws(() => MarkdownTransform.shiftHeadings(heading, 1.5), RangeError);
		assert.throws(() => MarkdownTransform.shiftHeadings(heading, Number.NaN), RangeError);
		assert.throws(() => MarkdownTransform.shiftHeadings(heading, 1, { min: 5, max: 3 }), RangeError);
		assert.throws(() => MarkdownTransform.shiftHeadings(heading, 1, { min: 0 as HeadingDepth }), RangeError);
		assert.throws(() => MarkdownTransform.shiftHeadings(heading, 1, { max: 7 as HeadingDepth }), RangeError);
	});
});

describe("MarkdownTransform.sections", () => {
	it("agrees with MarkdownDocument.sections over the corpus at every depth", () => {
		let compared = 0;
		const documents = [
			...corpus.map((example) => example.markdown),
			"pre\n\n# A\n\n## B\n\nx\n\n### C\n\n## D\n\n# E\n\n###### F\n\n## G\n",
			"---\ntitle: x\n---\n\n## One\n\nSetext\n======\n\n> # quoted\n\n### Three\n\n- # listed\n\n## Four\n",
			"### deep first\n\n## shallower\n\n### deeper\n\n#### deepest\n\n### back\n\n# top\n",
		];
		for (const source of documents) {
			const document = Result.getOrThrow(MarkdownDocument.parseResult(source, { frontmatter: true }));
			const children = document.root.children;
			for (const depth of [1, 2, 3, 4, 5, 6] as const) {
				const spans = MarkdownTransform.sections(document.root, { depth });
				const expected = document.sections.filter((section) => section.depth === depth);
				assert.strictEqual(spans.length, expected.length, `${JSON.stringify(source)} depth ${depth}`);
				spans.forEach((span, index) => {
					const section = expected[index];
					assert.strictEqual(span.heading, section?.heading);
					assert.strictEqual(children[span.headingIndex], span.heading);
					assert.deepStrictEqual(
						children
							.slice(span.headingIndex + 1, span.end)
							.filter((child) => child.type !== "frontmatter" && child.type !== "mdxjsEsm"),
						section?.children,
					);
					compared += 1;
				});
			}
		}
		assert.isAbove(compared, 70);
	});

	const changelog = "# Log\n\n## 2.0\n\n### Fixed\n\na\n\n### Added\n\nb\n\n## 1.0\n\n### Fixed\n\nc\n";

	it("nests: depth-2 blocks, then depth-3 sections inside one block's body", () => {
		const root = parse(changelog);
		const blocks = MarkdownTransform.sections(root, { depth: 2 });
		assert.deepStrictEqual(
			blocks.map((block) => [block.headingIndex, block.end]),
			[
				[1, 6],
				[6, 9],
			],
		);
		const first = blocks[0];
		assert.isDefined(first);
		const inner = MarkdownTransform.sections(root, {
			depth: 3,
			start: (first?.headingIndex ?? 0) + 1,
			end: first?.end ?? 0,
		});
		assert.deepStrictEqual(
			inner.map((span) => [span.headingIndex, span.end]),
			[
				[2, 4],
				[4, 6],
			],
		);
	});

	it("ends a section at a stray shallower heading, and the next-span idiom runs to the next same-depth heading", () => {
		// Pins both readings documented on MarkdownTransform.sections, on the
		// exact input its TSDoc example uses.
		const root = parse("## Features\n\n- a\n\n# Top\n\n- b\n");
		assert.deepStrictEqual(
			root.children.map((child) => child.type),
			["heading", "list", "heading", "list"],
		);
		const spans = MarkdownTransform.sections(root, { depth: 2 });
		assert.deepStrictEqual(
			spans.map((span) => [span.headingIndex, span.end]),
			[[0, 2]],
		);
		const bodies = spans.map((span, index) =>
			root.children.slice(span.headingIndex + 1, spans[index + 1]?.headingIndex ?? root.children.length),
		);
		assert.strictEqual(bodies.length, 1);
		assert.deepStrictEqual(
			bodies[0]?.map((child) => child.type),
			["list", "heading", "list"],
		);
		assert.strictEqual(bodies[0]?.[1], root.children[2]);
		// With a second same-depth heading the idiom stops at it.
		const two = parse("## A\n\nx\n\n# Top\n\ny\n\n## B\n\nz\n");
		const twoSpans = MarkdownTransform.sections(two, { depth: 2 });
		assert.deepStrictEqual(
			twoSpans.map((span) => [span.headingIndex, span.end]),
			[
				[0, 2],
				[4, 6],
			],
		);
		const twoBodies = twoSpans.map((span, index) =>
			two.children.slice(span.headingIndex + 1, twoSpans[index + 1]?.headingIndex ?? two.children.length),
		);
		assert.deepStrictEqual(
			twoBodies.map((body) => body.length),
			[3, 1],
		);
	});

	it("clamps a section's end to the window end", () => {
		const root = parse(changelog);
		assert.deepStrictEqual(
			MarkdownTransform.sections(root, { depth: 3, start: 0, end: 3 }).map((span) => [span.headingIndex, span.end]),
			[[2, 3]],
		);
	});

	it("works on a tree a map reshaped, with no source text", () => {
		const root = parse(changelog);
		const reshaped = MarkdownTransform.map(root, {
			root: (node) =>
				Root.make({
					children: [
						ThematicBreak.make({}),
						...node.children.filter((child) => child.type !== "paragraph"),
						Heading.make({ depth: 2, children: [Text.make({ value: "0.1" })] }),
					],
				}),
		});
		assert.deepStrictEqual(
			MarkdownTransform.sections(reshaped, { depth: 2 }).map((span) => [span.headingIndex, span.end]),
			[
				[2, 5],
				[5, 7],
				[7, 8],
			],
		);
	});

	it("throws RangeError on an invalid depth, or an out-of-range or inverted window", () => {
		const root = parse(changelog);
		const length = root.children.length;
		assert.throws(() => MarkdownTransform.sections(root, { depth: 2, start: -1 }), RangeError);
		assert.throws(() => MarkdownTransform.sections(root, { depth: 2, end: length + 1 }), RangeError);
		assert.throws(() => MarkdownTransform.sections(root, { depth: 2, start: 3, end: 2 }), RangeError);
		assert.throws(() => MarkdownTransform.sections(root, { depth: 2, start: 0.5 }), RangeError);
		for (const depth of [0, 7, 2.5, -1, Number.NaN]) {
			assert.throws(
				() => MarkdownTransform.sections(root, { depth: depth as HeadingDepth }),
				RangeError,
				undefined,
				`depth ${depth}`,
			);
		}
		assert.deepStrictEqual(MarkdownTransform.sections(root, { depth: 2, start: length, end: length }), []);
	});
});

describe("canonical output", () => {
	const source = "* a\n\nTitle\n=====\n\n_em_\n\n~~~\ncode\n~~~\n\n***\n";
	const canonicalMarkdown = "- a\n\n# Title\n\n*em*\n\n    code\n\n***\n";
	const parse = (text: string) => Result.getOrThrow(Markdown.parseResult(text));

	it("default stringify preserves the author's spelling", () => {
		assert.strictEqual(Result.getOrThrow(Markdown.stringifyResult(parse(source))), source);
	});

	it("canonical option re-emits canonically", () => {
		const out = Result.getOrThrow(Markdown.stringifyResult(parse(source), { canonical: true }));
		assert.strictEqual(out, canonicalMarkdown);
	});

	it("canonicalize clears fidelity so a plain stringify is canonical", () => {
		const out = Result.getOrThrow(Markdown.stringifyResult(MarkdownTransform.canonicalize(parse(source))));
		assert.strictEqual(out, canonicalMarkdown);
	});

	it("canonicalize never mutates its input", () => {
		const tree = parse(source);
		const before = JSON.stringify(tree);
		const result = MarkdownTransform.canonicalize(tree);
		assert.notStrictEqual(result, tree);
		assert.strictEqual(JSON.stringify(tree), before);
		assert.strictEqual(Result.getOrThrow(Markdown.stringifyResult(tree)), source);
	});

	it("canonicalize shares an already canonical tree", () => {
		const once = MarkdownTransform.canonicalize(parse(source));
		assert.strictEqual(MarkdownTransform.canonicalize(once), once);
	});

	it("stringify with canonical equals stringify of canonicalize", () => {
		const tree = parse(source);
		assert.strictEqual(
			Result.getOrThrow(Markdown.stringifyResult(tree, { canonical: true })),
			Result.getOrThrow(Markdown.stringifyResult(MarkdownTransform.canonicalize(tree))),
		);
	});

	it("canonical stringify fails typed past the depth cap instead of overflowing the stack", () => {
		const nested = (levels: number): Root => {
			let node: FlowContent = Paragraph.make({ children: [Text.make({ value: "x" })] });
			const ctor = Blockquote as unknown as new (
				input: unknown,
				options: { readonly disableChecks: true },
			) => Blockquote;
			for (let i = 0; i < levels; i += 1) {
				node = new ctor({ ...Blockquote.make({ children: [] }), children: [node] }, { disableChecks: true });
			}
			return Root.make({ children: [node] });
		};
		for (const levels of [300, 5000, 30000]) {
			const tree = nested(levels);
			for (const options of [undefined, { canonical: true }] as const) {
				const result = Markdown.stringifyResult(tree, options);
				assert.isTrue(Result.isFailure(result), `${levels} levels, ${JSON.stringify(options)}`);
				if (Result.isFailure(result)) {
					assert.strictEqual(result.failure.diagnostic.code, "NestingDepthExceeded");
				}
			}
		}
	});

	it("covers a hard break and a lone flow node", () => {
		const tree = parse("a  \nb\n");
		assert.strictEqual(Result.getOrThrow(Markdown.stringifyResult(tree)), "a  \nb\n");
		assert.strictEqual(Result.getOrThrow(Markdown.stringifyResult(tree, { canonical: true })), "a\\\nb\n");
	});
});
